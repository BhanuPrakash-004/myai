import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "./client";
import { requireAccess } from "./access";
import { AIError } from "../ai/errors";
import type { AIConfig } from "../ai/preferences";
export interface Usage { tokens?: number; promptTokens?: number; completionTokens?: number; cost?: number; requestId?: string }
export interface UsageLedger {
  start(task: string, model: string, reservedTokens: number, operationId?: string): Promise<string>;
  finish(id: string, outcome: string, usage: Usage, durationMs: number): Promise<void>;
}
export class UsageService implements UsageLedger {
  constructor(private pool: Pool, private limits: Pick<AIConfig, "dailyRequestLimit" | "dailyTokenBudget">) {}
  async start(task: string, model: string, reservedTokens: number, operationId?: string) {
    requireAccess();
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(71205001)");
      // Shared by web and workers. Provider calls have a 90-second deadline;
      // expired reservations cease occupying a slot but remain in the daily budget.
      const active = await client.query("SELECT count(*)::int AS n FROM usage_events WHERE outcome='inflight' AND created_at>now()-interval '120 seconds'");
      if (active.rows[0].n >= 4) throw new AIError("AI_BUSY");
      const totals = (await client.query("SELECT count(*)::int AS requests,coalesce(sum(coalesce(tokens,reserved_tokens)),0)::bigint AS tokens FROM usage_events WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'")).rows[0];
      if (totals.requests >= this.limits.dailyRequestLimit || Number(totals.tokens) + reservedTokens > this.limits.dailyTokenBudget) throw new AIError("AI_BUDGET");
      const id = randomUUID();
      await client.query("INSERT INTO usage_events(id,operation_id,model,task,reserved_tokens,duration_ms,outcome) VALUES($1,$2,$3,$4,$5,0,'inflight')", [id, operationId, model, task, reservedTokens]);
      return id;
    });
  }
  async finish(id: string, outcome: string, usage: Usage, durationMs: number) {
    requireAccess();
    await this.pool.query("UPDATE usage_events SET outcome=$2,tokens=$3,reported_cost=$4,request_id=$5,duration_ms=$6 WHERE id=$1 AND outcome='inflight'",
      [id, outcome, usage.tokens ?? null, usage.cost ?? null, usage.requestId ?? null, Math.max(0, Math.round(durationMs))]);
  }
  async summary() {
    requireAccess();
    return (await this.pool.query("SELECT count(*)::int AS requests,coalesce(sum(coalesce(tokens,reserved_tokens)),0)::bigint AS \"budgetedTokens\",coalesce(sum(tokens),0)::bigint AS \"reportedTokens\",coalesce(sum(reported_cost),0)::float AS \"reportedCost\",count(*) FILTER(WHERE tokens IS NULL)::int AS \"unreportedRequests\",count(*) FILTER(WHERE outcome='inflight')::int AS \"inflightRequests\" FROM usage_events WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'")).rows[0];
  }
}
