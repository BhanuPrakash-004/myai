CREATE TABLE "projection_cache" (
	"chunk_id" uuid NOT NULL,
	"input_key" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projection_cache_chunk_id_input_key_pk" PRIMARY KEY("chunk_id","input_key")
);
--> statement-breakpoint
ALTER TABLE "projection_cache" ADD CONSTRAINT "projection_cache_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;