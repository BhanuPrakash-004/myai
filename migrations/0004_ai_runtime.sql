CREATE TABLE "worker_heartbeats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"handlers" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_state" ADD COLUMN "run_token" uuid;--> statement-breakpoint
ALTER TABLE "processing_state" ADD COLUMN "input_key" text;--> statement-breakpoint
ALTER TABLE "processing_state" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "reserved_tokens" integer DEFAULT 0 NOT NULL;