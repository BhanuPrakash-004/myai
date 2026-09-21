ALTER TABLE "quiz_attempts_v2" ADD COLUMN "grade" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_attempts_v2" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "revealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quiz_sessions_v2" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "study_cards" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_fingerprint_unique" UNIQUE("fingerprint");