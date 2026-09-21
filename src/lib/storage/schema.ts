import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, jsonb, doublePrecision,
  primaryKey, uniqueIndex, index, check, foreignKey, vector, customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const metadata = () => jsonb("metadata").$type<Record<string, unknown>>().notNull().default({});
const contentHash = () => text("content_hash").generatedAlwaysAs(sql.raw("encode(digest(body, 'sha256'), 'hex')"));
const searchVector = customType<{ data: string }>({ dataType: () => "tsvector" });
export const provenance = pgEnum("provenance", ["user_written", "imported", "ai_generated", "ai_improved", "migrated_unknown"]);
export const lifecycle = pgEnum("lifecycle", ["active", "archived", "trashed"]);
export const reviewState = pgEnum("review_state", ["unreviewed", "owner_reviewed"]);
export const processingStatus = pgEnum("processing_status", ["pending", "processing", "ready", "failed", "stale"]);
export const operationStatus = pgEnum("operation_status", ["pending", "running", "completed", "failed", "cancelled", "interrupted"]);
export const nodeKind = pgEnum("node_kind", ["note", "concept", "topic", "source"]);
export const relationKind = pgEnum("relation_kind", ["contains", "mentions", "explains", "prerequisite_for", "related_to", "supports", "contradicts", "derived_from"]);
export const evidenceOrigin = pgEnum("evidence_origin", ["deterministic", "ai_extracted", "owner_curated"]);

// Better Auth's core shape. Public endpoints/provisioning are implemented in P04.
// The constant unique owner slot also blocks a second account at the DB boundary.
export const users = pgTable("auth_users", {
  id: text("id").primaryKey().default(sql.raw("gen_random_uuid()::text")),
  ownerSlot: boolean("owner_slot").notNull().default(true).unique(),
  name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
  createdAt: created(), updatedAt: updated(),
}, () => [check("owner_slot_true", sql.raw("owner_slot = true"))]);
export const sessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"), createdAt: created(), updatedAt: updated(),
});
export const accounts = pgTable("auth_accounts", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(), password: text("password"),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"), scope: text("scope"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  createdAt: created(), updatedAt: updated(),
}, (t) => [uniqueIndex("account_provider_unique").on(t.providerId, t.accountId)]);
export const verifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: created(), updatedAt: updated(),
});
export const installation = pgTable("installation", {
  singleton: boolean("singleton").primaryKey().default(true),
  id: uuid("id").notNull().defaultRandom(), ownerId: text("owner_id").references(() => users.id),
  createdAt: created(),
}, () => [check("installation_singleton", sql.raw("singleton = true"))]);
export const settings = pgTable("settings", {
  key: text("key").primaryKey(), value: jsonb("value").notNull(), updatedAt: updated(),
});

export const folders = pgTable("folders", {
  id: id(), parentId: uuid("parent_id").references((): AnyPgColumn => folders.id),
  name: text("name").notNull(), slug: text("slug").notNull(), sortOrder: integer("sort_order").notNull().default(0),
  createdAt: created(), updatedAt: updated(),
}, (t) => [
  uniqueIndex("folders_sibling_slug").on(t.parentId, t.slug),
  check("folder_not_self", sql.raw("parent_id IS NULL OR parent_id <> id")),
]);
export const folderAliases = pgTable("folder_aliases", {
  path: text("path").primaryKey(), folderId: uuid("folder_id").notNull().references(() => folders.id, { onDelete: "cascade" }),
  createdAt: created(),
});

export const notes = pgTable("notes", {
  id: id(), folderId: uuid("folder_id").notNull().references(() => folders.id), title: text("title").notNull(),
  body: text("body").notNull(), contentHash: contentHash(),
  currentVersion: integer("current_version").notNull().default(1),
  lifecycle: lifecycle("lifecycle").notNull().default("active"),
  provenance: provenance("provenance").notNull(), reviewState: reviewState("review_state").notNull().default("unreviewed"),
  importance: integer("importance").notNull().default(3),
  metadata: metadata(),
  search: searchVector("search_vector").generatedAlwaysAs(sql.raw("setweight(to_tsvector('simple', coalesce(title,'')), 'A') || setweight(to_tsvector('simple', body), 'B')")),
  createdAt: created(), updatedAt: updated(), trashedAt: timestamp("trashed_at", { withTimezone: true }),
}, (t) => [
  index("notes_folder").on(t.folderId), index("notes_lexical").using("gin", t.search),
  check("notes_positive_version", sql.raw("current_version > 0")),
  check("notes_importance_range", sql.raw("importance BETWEEN 1 AND 5")),
]);
export const operations = pgTable("operations", {
  id: id(), idempotencyKey: text("idempotency_key").notNull().unique(), requestHash: text("request_hash").notNull(),
  action: text("action").notNull(), status: operationStatus("status").notNull().default("pending"),
  folderId: uuid("folder_id").references(() => folders.id), noteId: uuid("note_id").references(() => notes.id),
  expectedVersion: integer("expected_version"), input: jsonb("input").notNull(),
  result: jsonb("result"), errorCode: text("error_code"), createdAt: created(), updatedAt: updated(),
});
export const noteVersions = pgTable("note_versions", {
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), title: text("title").notNull(), body: text("body").notNull(),
  contentHash: contentHash(), provenance: provenance("provenance").notNull(), reason: text("reason").notNull(),
  operationId: uuid("operation_id").references(() => operations.id), model: text("model"),
  metadata: metadata(),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.noteId, t.version] }), check("version_positive", sql.raw("version > 0"))]);
export const noteAliases = pgTable("note_aliases", {
  path: text("path").primaryKey(), noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
});
export const noteRoutes = pgTable("note_routes", {
  noteId: uuid("note_id").primaryKey().references(() => notes.id, { onDelete: "cascade" }),
  path: text("path").notNull().unique(),
});
export const loginThrottle = pgTable("auth_login_throttle", {
  key: text("key").primaryKey(), attempts: integer("attempts").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});
export const reviewSessions = pgTable("reading_sessions", {
  id: id(), mode: text("mode").notNull(), createdAt: created(),
});
export const reviewItems = pgTable("reading_items", {
  sessionId: uuid("session_id").notNull().references(() => reviewSessions.id, { onDelete: "cascade" }),
  noteId: uuid("note_id").notNull(), noteVersion: integer("note_version").notNull(),
  remembered: boolean("remembered"), answeredAt: timestamp("answered_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.sessionId, t.noteId] }),
  foreignKey({ columns: [t.noteId, t.noteVersion], foreignColumns: [noteVersions.noteId, noteVersions.version] }),
]);
export const attachments = pgTable("attachments", {
  id: id(), storageKey: text("storage_key").notNull().unique(), originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(), byteSize: integer("byte_size").notNull(), sha256: text("sha256").notNull(),
  state: text("state").notNull().default("staged"), createdAt: created(),
}, () => [check("attachment_size", sql.raw("byte_size >= 0")), check("attachment_state", sql.raw("state IN ('staged', 'ready', 'failed', 'purged')"))]);
export const sources = pgTable("sources", {
  id: id(), origin: provenance("origin").notNull(), body: text("body").notNull(), contentHash: contentHash(),
  attachmentId: uuid("attachment_id").references(() => attachments.id), originUrl: text("origin_url"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  validAsOf: timestamp("valid_as_of", { withTimezone: true }), metadata: metadata(), createdAt: created(),
});
export const noteSources = pgTable("note_sources", {
  noteId: uuid("note_id").notNull(), version: integer("version").notNull(),
  sourceId: uuid("source_id").notNull().references(() => sources.id),
}, (t) => [
  primaryKey({ columns: [t.noteId, t.version, t.sourceId] }),
  foreignKey({ columns: [t.noteId, t.version], foreignColumns: [noteVersions.noteId, noteVersions.version] }).onDelete("cascade"),
]);
export const improvementProposals = pgTable("improvement_proposals", {
  id: id(), operationId: uuid("operation_id").notNull().references(() => operations.id),
  noteId: uuid("note_id").references(() => notes.id), expectedVersion: integer("expected_version"),
  original: text("original").notNull(), proposed: text("proposed").notNull(), state: text("state").notNull().default("pending"),
  createdAt: created(),
}, () => [check("proposal_state", sql.raw("state IN ('pending', 'applied', 'rejected', 'cancelled')"))]);
export const conversations = pgTable("conversations", {
  id: id(), title: text("title").notNull(), folderId: uuid("folder_id").references(() => folders.id),
  archived: boolean("archived").notNull().default(false), createdAt: created(), updatedAt: updated(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
export const messages = pgTable("messages", {
  id: id(), conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(), role: text("role").notNull(), content: text("content").notNull(),
  status: text("status").notNull(), operationId: uuid("operation_id").references(() => operations.id),
  model: text("model"), metadata: metadata(), createdAt: created(),
}, (t) => [
  uniqueIndex("message_sequence").on(t.conversationId, t.sequence),
  check("message_role", sql.raw("role IN ('user', 'assistant', 'system')")),
  check("message_status", sql.raw("status IN ('streaming', 'completed', 'interrupted', 'failed', 'cancelled')")),
]);
export const chunks = pgTable("chunks", {
  id: id(), noteId: uuid("note_id").notNull(), noteVersion: integer("note_version").notNull(),
  ordinal: integer("ordinal").notNull(), body: text("body").notNull(), contentHash: contentHash(),
  startOffset: integer("start_offset").notNull(), endOffset: integer("end_offset").notNull(),
  heading: text("heading"), page: integer("page"), tokenCount: integer("token_count"),
  chunkerVersion: text("chunker_version").notNull(), createdAt: created(),
}, (t) => [
  foreignKey({ columns: [t.noteId, t.noteVersion], foreignColumns: [noteVersions.noteId, noteVersions.version] }).onDelete("cascade"),
  uniqueIndex("chunk_position").on(t.noteId, t.noteVersion, t.chunkerVersion, t.ordinal),
  index("chunks_note_current").on(t.noteId, t.noteVersion, t.chunkerVersion),
  check("chunk_offsets", sql.raw("start_offset >= 0 AND end_offset > start_offset")),
]);
export const embeddingProfiles = pgTable("embedding_profiles", {
  id: id(), model: text("model").notNull(), dimensions: integer("dimensions").notNull(),
  normalization: text("normalization").notNull().default("provider"), chunkerVersion: text("chunker_version").notNull(),
  active: boolean("active").notNull().default(false), createdAt: created(),
}, (t) => [
  uniqueIndex("embedding_profile_identity").on(t.model, t.dimensions, t.normalization, t.chunkerVersion),
  uniqueIndex("one_active_embedding_profile").on(t.active).where(sql.raw("active = true")),
  check("embedding_dimensions", sql.raw("dimensions = 1536")),
]);
export const chunkEmbeddings = pgTable("chunk_embeddings", {
  chunkId: uuid("chunk_id").notNull().references(() => chunks.id, { onDelete: "cascade" }),
  profileId: uuid("profile_id").notNull().references(() => embeddingProfiles.id),
  embedding: vector("embedding", { dimensions: 1536 }).notNull(), createdAt: created(),
}, (t) => [primaryKey({ columns: [t.chunkId, t.profileId] })]);

export const graphNodes = pgTable("graph_nodes", {
  id: id(), kind: nodeKind("kind").notNull(), label: text("label").notNull(),
  identityKey: text("identity_key").notNull(), scopeFolderId: uuid("scope_folder_id").notNull().references(() => folders.id),
  noteId: uuid("note_id").unique().references(() => notes.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").unique().references(() => sources.id, { onDelete: "cascade" }),
  origin: evidenceOrigin("origin").notNull(), metadata: metadata(), createdAt: created(),
}, (t) => [
  uniqueIndex("graph_identity").on(t.kind, t.scopeFolderId, t.identityKey),
  check("graph_node_reference", sql.raw("(kind = 'note' AND note_id IS NOT NULL AND source_id IS NULL) OR (kind = 'source' AND source_id IS NOT NULL AND note_id IS NULL) OR (kind IN ('concept', 'topic') AND note_id IS NULL AND source_id IS NULL)")),
]);
export const conceptAliases = pgTable("concept_aliases", {
  nodeId: uuid("node_id").notNull().references(() => graphNodes.id, { onDelete: "cascade" }),
  scopeFolderId: uuid("scope_folder_id").notNull().references(() => folders.id),
  alias: text("alias").notNull(),
}, (t) => [primaryKey({ columns: [t.nodeId, t.alias] }), uniqueIndex("concept_alias_scope").on(t.scopeFolderId, t.alias)]);
export const graphEdges = pgTable("graph_edges", {
  id: id(), fromNodeId: uuid("from_node_id").notNull().references(() => graphNodes.id, { onDelete: "cascade" }),
  toNodeId: uuid("to_node_id").notNull().references(() => graphNodes.id, { onDelete: "cascade" }),
  relation: relationKind("relation").notNull(), origin: evidenceOrigin("origin").notNull(),
  reviewState: reviewState("review_state").notNull().default("unreviewed"),
  confidence: doublePrecision("confidence"), model: text("model"), extractorVersion: text("extractor_version"),
  disabled: boolean("disabled").notNull().default(false), revision: integer("revision").notNull().default(1),
  createdAt: created(),
}, (t) => [
  uniqueIndex("graph_edge_identity").on(t.fromNodeId, t.toNodeId, t.relation, t.origin),
  index("graph_incoming").on(t.toNodeId),
  check("graph_not_self", sql.raw("from_node_id <> to_node_id")),
  check("edge_confidence", sql.raw("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)")),
]);
export const graphEvidence = pgTable("graph_evidence", {
  id: id(), edgeId: uuid("edge_id").notNull().references(() => graphEdges.id, { onDelete: "cascade" }),
  chunkId: uuid("chunk_id").notNull().references(() => chunks.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").references(() => sources.id),
  startOffset: integer("start_offset").notNull(), endOffset: integer("end_offset").notNull(),
  quote: text("quote").notNull(), createdAt: created(),
}, (t) => [
  uniqueIndex("edge_evidence_identity").on(t.edgeId, t.chunkId, t.startOffset, t.endOffset),
  index("graph_evidence_chunk").on(t.chunkId),
  check("evidence_offsets", sql.raw("start_offset >= 0 AND end_offset > start_offset")),
]);
export const messageCitations = pgTable("message_citations", {
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  label: text("label").notNull(), chunkId: uuid("chunk_id").notNull().references(() => chunks.id),
  quote: text("quote").notNull(),
}, (t) => [primaryKey({ columns: [t.messageId, t.label] })]);

export const studyCards = pgTable("study_cards", {
  fingerprint: text("fingerprint").unique(),
  id: id(), noteId: uuid("note_id").notNull(), noteVersion: integer("note_version").notNull(),
  chunkId: uuid("chunk_id").references(() => chunks.id), kind: text("kind").notNull(),
  prompt: text("prompt").notNull(), answer: text("answer").notNull(), rubric: jsonb("rubric").notNull().default({}),
  stale: boolean("stale").notNull().default(false), createdAt: created(),
}, (t) => [foreignKey({ columns: [t.noteId, t.noteVersion], foreignColumns: [noteVersions.noteId, noteVersions.version] })]);
export const reviewSchedule = pgTable("review_schedule", {
  cardId: uuid("card_id").primaryKey().references(() => studyCards.id, { onDelete: "cascade" }),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(), intervalDays: doublePrecision("interval_days").notNull().default(0),
  algorithmVersion: text("algorithm_version").notNull(), state: jsonb("state").notNull().default({}), updatedAt: updated(),
}, (t) => [index("reviews_due").on(t.dueAt), check("review_interval", sql.raw("interval_days >= 0"))]);
export const reviewEvents = pgTable("review_events", {
  id: id(), cardId: uuid("card_id").notNull().references(() => studyCards.id), submissionKey: text("submission_key").notNull().unique(),
  rating: integer("rating").notNull(), algorithmVersion: text("algorithm_version").notNull(),
  previousState: jsonb("previous_state").notNull(), nextState: jsonb("next_state").notNull(), createdAt: created(),
}, () => [check("recall_rating", sql.raw("rating BETWEEN 0 AND 3"))]);
export const quizSessions = pgTable("quiz_sessions_v2", {
  metadata: metadata(),
  id: id(), folderId: uuid("folder_id").references(() => folders.id), mode: text("mode").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }), createdAt: created(),
});
// Durable inference staging. Only fenced stage publication makes these results retrievable.
export const projectionCache = pgTable("projection_cache", {
  chunkId: uuid("chunk_id").notNull().references(() => chunks.id, { onDelete: "cascade" }),
  inputKey: text("input_key").notNull(), result: jsonb("result").notNull(), createdAt: created(),
}, (t) => [primaryKey({ columns: [t.chunkId, t.inputKey] })]);
export const quizQuestions = pgTable("quiz_questions", {
  revealedAt: timestamp("revealed_at", { withTimezone: true }),
  id: id(), sessionId: uuid("session_id").notNull().references(() => quizSessions.id, { onDelete: "cascade" }),
  cardId: uuid("card_id").references(() => studyCards.id), sequence: integer("sequence").notNull(),
  prompt: text("prompt").notNull(), options: jsonb("options"), answerKey: jsonb("answer_key").notNull(),
  rubric: jsonb("rubric").notNull().default({}), chunkId: uuid("chunk_id").references(() => chunks.id),
}, (t) => [uniqueIndex("quiz_question_sequence").on(t.sessionId, t.sequence), uniqueIndex("quiz_question_membership").on(t.id, t.sessionId)]);
export const quizAttempts = pgTable("quiz_attempts_v2", {
  grade: jsonb("grade").notNull().default({}), revision: integer("revision").notNull().default(1),
  id: id(), sessionId: uuid("session_id").notNull(), questionId: uuid("question_id").notNull(),
  submissionKey: text("submission_key").notNull().unique(), answer: jsonb("answer").notNull(),
  isCorrect: boolean("is_correct"), feedback: text("feedback").notNull(), createdAt: created(),
}, (t) => [
  foreignKey({ columns: [t.questionId, t.sessionId], foreignColumns: [quizQuestions.id, quizQuestions.sessionId] }).onDelete("cascade"),
  uniqueIndex("quiz_one_attempt").on(t.sessionId, t.questionId),
]);
export const processingState = pgTable("processing_state", {
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }), noteVersion: integer("note_version").notNull(),
  stage: text("stage").notNull(), status: processingStatus("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0), errorCode: text("error_code"), updatedAt: updated(),
  runToken: uuid("run_token"), inputKey: text("input_key"), heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.noteId, t.noteVersion, t.stage] }),
  foreignKey({ columns: [t.noteId, t.noteVersion], foreignColumns: [noteVersions.noteId, noteVersions.version] }).onDelete("cascade"),
  check("processing_stage", sql.raw("stage IN ('chunks', 'embeddings', 'graph')")),
]);
export const usageEvents = pgTable("usage_events", {
  id: id(), operationId: uuid("operation_id").references(() => operations.id), model: text("model").notNull(),
  task: text("task").notNull(), requestId: text("request_id"), tokens: integer("tokens"),
  reportedCost: doublePrecision("reported_cost"), durationMs: integer("duration_ms").notNull(),
  outcome: text("outcome").notNull(), createdAt: created(),
  reservedTokens: integer("reserved_tokens").notNull().default(0),
});
export const workerHeartbeats = pgTable("worker_heartbeats", {
  id: uuid("id").primaryKey(), startedAt: created(), heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull(), handlers: jsonb("handlers").$type<string[]>().notNull().default([]),
});
export const importItems = pgTable("import_items", {
  sourceKey: text("source_key").primaryKey(), sourceHash: text("source_hash").notNull(),
  sourceId: uuid("source_id").notNull().references(() => sources.id),
  noteId: uuid("note_id").notNull().references(() => notes.id),
  legacyPath: text("legacy_path").notNull(), createdAt: created(),
});
