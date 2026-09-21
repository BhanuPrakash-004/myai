import { randomUUID } from "node:crypto";
import { z } from "zod";
import { KnowledgeService, hash } from "./knowledge";
import { transaction, ROOT_FOLDER_ID } from "./client";
import { DomainError, requireAccess } from "./access";
import { AIContentService } from "../ai/content";
import type { OpenRouterClient } from "../ai/openrouter";
import { safeAIError } from "../ai/errors";

const inputSchema = z.object({ title: z.string().trim().min(1).max(200), body: z.string().min(1).max(200000),
  instructions: z.string().max(8000).optional(),
  conversationId: z.uuid().optional(), messageId: z.uuid().optional(),
  folderId: z.guid().default(ROOT_FOLDER_ID), noteId: z.uuid().optional(), expectedVersion: z.number().int().positive().optional() }).strict()
  .refine((v) => Boolean(v.noteId) === Boolean(v.expectedVersion), "An existing note requires its version.");
const applySchema = z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(1000000), importance: z.number().int().min(1).max(5).default(3) }).strict();
export class ImprovementService {
  constructor(private knowledge: KnowledgeService) {}
  async propose(raw: unknown, key: string, provider: OpenRouterClient, signal?: AbortSignal) {
    requireAccess(); const input = inputSchema.parse(raw), requestHash = hash(JSON.stringify(input));
    const operation = await transaction(this.knowledge.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["improve:" + key]);
      const previous = (await client.query("SELECT * FROM operations WHERE idempotency_key=$1", ["improve:" + key])).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "The request key belongs to another draft.", 409);
        if (previous.status === "completed") return { id: previous.id, result: previous.result };
        throw new DomainError("IMPROVEMENT_PENDING", "The previous request is recorded. Check its status before requesting another proposal.", 409, { operationId: previous.id });
      }
      if (input.noteId) {
        const note = await this.knowledge.get(input.noteId, true);
        if (!note || note.current_version !== input.expectedVersion || note.lifecycle === "trashed") throw new DomainError("VERSION_CONFLICT", "Reload and review the current note before improving.", 409);
      }
      const id = randomUUID();
      await client.query("INSERT INTO operations(id,idempotency_key,request_hash,action,status,folder_id,input) VALUES($1,$2,$3,'improve','running',$4,$5)", [id, "improve:" + key, requestHash, input.folderId, JSON.stringify(input)]);
      return { id, result: null };
    });
    if (operation.result) return operation.result;
    try {
      const proposed = await new AIContentService(provider).improve(input.body, { signal, operationId: operation.id }, input.instructions);
      if (signal?.aborted) throw new DomainError("AI_CANCELLED", "Improvement cancelled.");
      const id = randomUUID(), result = { id, ...proposed, original: input.body, originalTitle: input.title, model: provider.config.structuredModel, state: "pending" };
      await transaction(this.knowledge.pool, async (client) => {
        await client.query("INSERT INTO improvement_proposals(id,operation_id,note_id,expected_version,original,proposed) VALUES($1,$2,$3,$4,$5,$6)", [id, operation.id, input.noteId, input.expectedVersion, input.body, proposed.body]);
        await client.query("UPDATE operations SET status='completed',result=$2,updated_at=now() WHERE id=$1", [operation.id, JSON.stringify(result)]);
      });
      return result;
    } catch (error) {
      const safe = safeAIError(error, signal);
      await this.knowledge.pool.query("UPDATE operations SET status=$2,error_code=$3,updated_at=now() WHERE id=$1", [operation.id, signal?.aborted ? "cancelled" : "failed", safe.code]);
      throw safe;
    }
  }
  async decide(id: string, decision: "apply" | "original" | "reject" | "cancel", raw: unknown, key: string) {
    requireAccess(); z.uuid().parse(id);
    const changes = decision === "apply" || decision === "original" ? applySchema.parse(raw) : null;
    return transaction(this.knowledge.pool, async (client) => {
      const proposal = (await client.query("SELECT p.*,o.input,o.result FROM improvement_proposals p JOIN operations o ON o.id=p.operation_id WHERE p.id=$1 FOR UPDATE OF p", [id])).rows[0];
      if (!proposal) throw new DomainError("NOT_FOUND", "Improvement proposal not found.", 404);
      if (proposal.state === "applied") {
        if ((decision === "apply" || decision === "original") && proposal.result.applyKey === key && proposal.result.applyHash === hash(JSON.stringify({ decision, changes }))) return { receipt: proposal.result.receipt };
        throw new DomainError("PROPOSAL_CLOSED", "This proposal was already applied. Open the saved note.", 409);
      }
      if (proposal.state !== "pending") throw new DomainError("PROPOSAL_CLOSED", "This proposal is closed. Your original draft is preserved.", 409);
      if (!changes) { await client.query("UPDATE improvement_proposals SET state=$2 WHERE id=$1", [id, decision === "reject" ? "rejected" : "cancelled"]); return { state: decision }; }
      const input = inputSchema.parse(proposal.input);
      const current = input.noteId ? await this.knowledge.get(input.noteId, true) : null;
      const receipt = await this.knowledge.executeInTransaction(client, {
        ...(input.noteId ? { action: "edit" as const, noteId: input.noteId, expectedVersion: input.expectedVersion! } : { action: "create" as const, folderId: input.folderId }),
        ...changes, ...(decision === "original" ? { title: input.title, body: proposal.original } : {}),
        idempotencyKey: "improvement-apply:" + key, provenance: decision === "original" ? "user_written" : "ai_improved", model: decision === "original" ? undefined : proposal.result.model,
        metadata: { ...current?.metadata, improvementProposalId: id, ...(input.conversationId ? { conversationId: input.conversationId, messageId: input.messageId } : {}) },
        sources: [{ body: proposal.original, origin: "user_written", metadata: { title: input.title, improvementProposalId: id, noteId: input.noteId, version: input.expectedVersion, conversationId: input.conversationId, messageId: input.messageId, instructions: input.instructions } }],
      });
      await client.query("UPDATE improvement_proposals SET state='applied' WHERE id=$1", [id]);
      await client.query("UPDATE operations SET result=result || $2::jsonb,updated_at=now() WHERE id=$1", [proposal.operation_id, JSON.stringify({ receipt, applyKey: key, applyHash: hash(JSON.stringify({ decision, changes })) })]);
      return { receipt };
    });
  }
}
