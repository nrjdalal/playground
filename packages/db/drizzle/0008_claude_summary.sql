CREATE TABLE "claude_summary" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"model" text NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"read_to" bigint DEFAULT 0 NOT NULL,
	"session_id" text NOT NULL,
	"summary" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claude_summary_session_id_unique" UNIQUE("session_id")
);
