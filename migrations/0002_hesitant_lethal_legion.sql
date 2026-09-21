CREATE TABLE "auth_login_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_routes" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	CONSTRAINT "note_routes_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "reading_items" (
	"session_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"note_version" integer NOT NULL,
	"remembered" boolean,
	"answered_at" timestamp with time zone,
	CONSTRAINT "reading_items_session_id_note_id_pk" PRIMARY KEY("session_id","note_id")
);
--> statement-breakpoint
CREATE TABLE "reading_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_versions" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "note_routes" ADD CONSTRAINT "note_routes_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_items" ADD CONSTRAINT "reading_items_session_id_reading_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."reading_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_items" ADD CONSTRAINT "reading_items_note_id_note_version_note_versions_note_id_version_fk" FOREIGN KEY ("note_id","note_version") REFERENCES "public"."note_versions"("note_id","version") ON DELETE no action ON UPDATE no action;