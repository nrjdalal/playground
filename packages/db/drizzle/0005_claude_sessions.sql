CREATE TABLE "claude_entry" (
	"at" timestamp with time zone,
	"cache_creation_tokens" bigint,
	"cache_read_tokens" bigint,
	"input_tokens" bigint,
	"kind" text NOT NULL,
	"message_id" text,
	"model" text,
	"output_tokens" bigint,
	"parent_uuid" text,
	"raw" jsonb NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, left("text", 100000))) STORED,
	"sender" text,
	"seq" bigint NOT NULL,
	"session_id" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"tool" text,
	"tool_use_id" text,
	"type" text NOT NULL,
	"uuid" text NOT NULL,
	CONSTRAINT "claude_entry_session_id_uuid_pk" PRIMARY KEY("session_id","uuid")
);
--> statement-breakpoint
CREATE TABLE "claude_session" (
	"agent_type" text,
	"ai_title" text,
	"cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" numeric,
	"costs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cwd" text,
	"description" text,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"git_branch" text,
	"id" text PRIMARY KEY NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"kind" text,
	"last_active_at" timestamp with time zone,
	"model" text,
	"name" text,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"parent_id" text,
	"pr_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"project_dir" text,
	"started_at" timestamp with time zone,
	"task" text,
	"version" text
);
--> statement-breakpoint
CREATE TABLE "claude_transcript" (
	"byte_offset" bigint DEFAULT 0 NOT NULL,
	"dev" bigint NOT NULL,
	"ino" bigint NOT NULL,
	"path" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"size" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claude_entry" ADD CONSTRAINT "claude_entry_session_id_claude_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."claude_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_session" ADD CONSTRAINT "claude_session_parent_id_claude_session_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."claude_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_transcript" ADD CONSTRAINT "claude_transcript_session_id_claude_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."claude_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claude_entry_search_idx" ON "claude_entry" USING gin ("search");--> statement-breakpoint
CREATE INDEX "claude_entry_session_id_seq_idx" ON "claude_entry" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "claude_session_last_active_at_idx" ON "claude_session" USING btree ("last_active_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "claude_session_parent_id_idx" ON "claude_session" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "claude_transcript_session_id_idx" ON "claude_transcript" USING btree ("session_id");