CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."evidence_origin" AS ENUM('deterministic', 'ai_extracted', 'owner_curated');--> statement-breakpoint
CREATE TYPE "public"."lifecycle" AS ENUM('active', 'archived', 'trashed');--> statement-breakpoint
CREATE TYPE "public"."node_kind" AS ENUM('note', 'concept', 'topic', 'source');--> statement-breakpoint
CREATE TYPE "public"."operation_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processing', 'ready', 'failed', 'stale');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('user_written', 'imported', 'ai_generated', 'ai_improved', 'migrated_unknown');--> statement-breakpoint
CREATE TYPE "public"."relation_kind" AS ENUM('contains', 'mentions', 'explains', 'prerequisite_for', 'related_to', 'supports', 'contradicts', 'derived_from');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('unreviewed', 'owner_reviewed');--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"scope" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"state" text DEFAULT 'staged' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "attachment_size" CHECK (byte_size >= 0),
	CONSTRAINT "attachment_state" CHECK (state IN ('staged', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "chunk_embeddings" (
	"chunk_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunk_embeddings_chunk_id_profile_id_pk" PRIMARY KEY("chunk_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"note_version" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"body" text NOT NULL,
	"content_hash" text GENERATED ALWAYS AS (encode(digest(body, 'sha256'), 'hex')) STORED,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"heading" text,
	"page" integer,
	"token_count" integer,
	"chunker_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunk_offsets" CHECK (start_offset >= 0 AND end_offset > start_offset)
);
--> statement-breakpoint
CREATE TABLE "concept_aliases" (
	"node_id" uuid NOT NULL,
	"scope_folder_id" uuid NOT NULL,
	"alias" text NOT NULL,
	CONSTRAINT "concept_aliases_node_id_alias_pk" PRIMARY KEY("node_id","alias")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"folder_id" uuid,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"normalization" text DEFAULT 'provider' NOT NULL,
	"chunker_version" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_dimensions" CHECK (dimensions = 1536)
);
--> statement-breakpoint
CREATE TABLE "folder_aliases" (
	"path" text PRIMARY KEY NOT NULL,
	"folder_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folder_not_self" CHECK (parent_id IS NULL OR parent_id <> id)
);
--> statement-breakpoint
CREATE TABLE "graph_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"relation" "relation_kind" NOT NULL,
	"origin" "evidence_origin" NOT NULL,
	"review_state" "review_state" DEFAULT 'unreviewed' NOT NULL,
	"confidence" double precision,
	"model" text,
	"extractor_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_not_self" CHECK (from_node_id <> to_node_id),
	CONSTRAINT "edge_confidence" CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
--> statement-breakpoint
CREATE TABLE "graph_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edge_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"source_id" uuid,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"quote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_offsets" CHECK (start_offset >= 0 AND end_offset > start_offset)
);
--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "node_kind" NOT NULL,
	"label" text NOT NULL,
	"identity_key" text NOT NULL,
	"scope_folder_id" uuid NOT NULL,
	"note_id" uuid,
	"source_id" uuid,
	"origin" "evidence_origin" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_nodes_note_id_unique" UNIQUE("note_id"),
	CONSTRAINT "graph_nodes_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "graph_node_reference" CHECK ((kind = 'note' AND note_id IS NOT NULL AND source_id IS NULL) OR (kind = 'source' AND source_id IS NOT NULL AND note_id IS NULL) OR (kind IN ('concept', 'topic') AND note_id IS NULL AND source_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "import_items" (
	"source_key" text PRIMARY KEY NOT NULL,
	"source_hash" text NOT NULL,
	"source_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"legacy_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "improvement_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"note_id" uuid,
	"expected_version" integer,
	"original" text NOT NULL,
	"proposed" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_state" CHECK (state IN ('pending', 'applied', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "installation" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_singleton" CHECK (singleton = true)
);
--> statement-breakpoint
CREATE TABLE "message_citations" (
	"message_id" uuid NOT NULL,
	"label" text NOT NULL,
	"chunk_id" uuid NOT NULL,
	"quote" text NOT NULL,
	CONSTRAINT "message_citations_message_id_label_pk" PRIMARY KEY("message_id","label")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"status" text NOT NULL,
	"operation_id" uuid,
	"model" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_role" CHECK (role IN ('user', 'assistant', 'system')),
	CONSTRAINT "message_status" CHECK (status IN ('streaming', 'completed', 'interrupted', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "note_aliases" (
	"path" text PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_sources" (
	"note_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "note_sources_note_id_version_source_id_pk" PRIMARY KEY("note_id","version","source_id")
);
--> statement-breakpoint
CREATE TABLE "note_versions" (
	"note_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"content_hash" text GENERATED ALWAYS AS (encode(digest(body, 'sha256'), 'hex')) STORED,
	"provenance" "provenance" NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_versions_note_id_version_pk" PRIMARY KEY("note_id","version"),
	CONSTRAINT "version_positive" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"content_hash" text GENERATED ALWAYS AS (encode(digest(body, 'sha256'), 'hex')) STORED,
	"current_version" integer DEFAULT 1 NOT NULL,
	"lifecycle" "lifecycle" DEFAULT 'active' NOT NULL,
	"provenance" "provenance" NOT NULL,
	"review_state" "review_state" DEFAULT 'unreviewed' NOT NULL,
	"importance" integer DEFAULT 3 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title,'')), 'A') || setweight(to_tsvector('simple', body), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trashed_at" timestamp with time zone,
	CONSTRAINT "notes_positive_version" CHECK (current_version > 0),
	CONSTRAINT "notes_importance_range" CHECK (importance BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"action" text NOT NULL,
	"status" "operation_status" DEFAULT 'pending' NOT NULL,
	"folder_id" uuid,
	"note_id" uuid,
	"expected_version" integer,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "processing_state" (
	"note_id" uuid NOT NULL,
	"note_version" integer NOT NULL,
	"stage" text NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_state_note_id_note_version_stage_pk" PRIMARY KEY("note_id","note_version","stage"),
	CONSTRAINT "processing_stage" CHECK (stage IN ('chunks', 'embeddings', 'graph'))
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts_v2" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"submission_key" text NOT NULL,
	"answer" jsonb NOT NULL,
	"is_correct" boolean,
	"feedback" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_attempts_v2_submission_key_unique" UNIQUE("submission_key")
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"card_id" uuid,
	"sequence" integer NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb,
	"answer_key" jsonb NOT NULL,
	"rubric" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chunk_id" uuid
);
--> statement-breakpoint
CREATE TABLE "quiz_sessions_v2" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid,
	"mode" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"submission_key" text NOT NULL,
	"rating" integer NOT NULL,
	"algorithm_version" text NOT NULL,
	"previous_state" jsonb NOT NULL,
	"next_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_events_submission_key_unique" UNIQUE("submission_key"),
	CONSTRAINT "recall_rating" CHECK (rating BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "review_schedule" (
	"card_id" uuid PRIMARY KEY NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"interval_days" double precision DEFAULT 0 NOT NULL,
	"algorithm_version" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_interval" CHECK (interval_days >= 0)
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin" "provenance" NOT NULL,
	"body" text NOT NULL,
	"content_hash" text GENERATED ALWAYS AS (encode(digest(body, 'sha256'), 'hex')) STORED,
	"attachment_id" uuid,
	"origin_url" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_as_of" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"note_version" integer NOT NULL,
	"chunk_id" uuid,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"answer" text NOT NULL,
	"rubric" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"request_id" text,
	"tokens" integer,
	"reported_cost" double precision,
	"duration_ms" integer NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"owner_slot" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_owner_slot_unique" UNIQUE("owner_slot"),
	CONSTRAINT "auth_users_email_unique" UNIQUE("email"),
	CONSTRAINT "owner_slot_true" CHECK (owner_slot = true)
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_profile_id_embedding_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."embedding_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_note_id_note_version_note_versions_note_id_version_fk" FOREIGN KEY ("note_id","note_version") REFERENCES "public"."note_versions"("note_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_aliases" ADD CONSTRAINT "concept_aliases_node_id_graph_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_aliases" ADD CONSTRAINT "concept_aliases_scope_folder_id_folders_id_fk" FOREIGN KEY ("scope_folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_aliases" ADD CONSTRAINT "folder_aliases_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_from_node_id_graph_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_to_node_id_graph_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_evidence" ADD CONSTRAINT "graph_evidence_edge_id_graph_edges_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."graph_edges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_evidence" ADD CONSTRAINT "graph_evidence_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_evidence" ADD CONSTRAINT "graph_evidence_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_scope_folder_id_folders_id_fk" FOREIGN KEY ("scope_folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_proposals" ADD CONSTRAINT "improvement_proposals_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_proposals" ADD CONSTRAINT "improvement_proposals_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation" ADD CONSTRAINT "installation_owner_id_auth_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_aliases" ADD CONSTRAINT "note_aliases_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_sources" ADD CONSTRAINT "note_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_sources" ADD CONSTRAINT "note_sources_note_id_version_note_versions_note_id_version_fk" FOREIGN KEY ("note_id","version") REFERENCES "public"."note_versions"("note_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_state" ADD CONSTRAINT "processing_state_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_state" ADD CONSTRAINT "processing_state_note_id_note_version_note_versions_note_id_version_fk" FOREIGN KEY ("note_id","note_version") REFERENCES "public"."note_versions"("note_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_question_membership" ON "quiz_questions" USING btree ("id","session_id");--> statement-breakpoint
ALTER TABLE "quiz_attempts_v2" ADD CONSTRAINT "quiz_attempts_v2_question_id_session_id_quiz_questions_id_session_id_fk" FOREIGN KEY ("question_id","session_id") REFERENCES "public"."quiz_questions"("id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_session_id_quiz_sessions_v2_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."quiz_sessions_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_card_id_study_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."study_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_sessions_v2" ADD CONSTRAINT "quiz_sessions_v2_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_card_id_study_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."study_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_schedule" ADD CONSTRAINT "review_schedule_card_id_study_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."study_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_note_id_note_version_note_versions_note_id_version_fk" FOREIGN KEY ("note_id","note_version") REFERENCES "public"."note_versions"("note_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_unique" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chunk_position" ON "chunks" USING btree ("note_id","note_version","chunker_version","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_alias_scope" ON "concept_aliases" USING btree ("scope_folder_id","alias");--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_profile_identity" ON "embedding_profiles" USING btree ("model","dimensions","normalization","chunker_version");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_embedding_profile" ON "embedding_profiles" USING btree ("active") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_sibling_slug" ON "folders" USING btree ("parent_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_edge_identity" ON "graph_edges" USING btree ("from_node_id","to_node_id","relation","origin");--> statement-breakpoint
CREATE INDEX "graph_incoming" ON "graph_edges" USING btree ("to_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "edge_evidence_identity" ON "graph_evidence" USING btree ("edge_id","chunk_id","start_offset","end_offset");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_identity" ON "graph_nodes" USING btree ("kind","scope_folder_id","identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "message_sequence" ON "messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "notes_folder" ON "notes" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "notes_lexical" ON "notes" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_one_attempt" ON "quiz_attempts_v2" USING btree ("session_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_question_sequence" ON "quiz_questions" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "reviews_due" ON "review_schedule" USING btree ("due_at");
