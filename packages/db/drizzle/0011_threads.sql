CREATE TABLE "thread" (
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"last_read_at" timestamp with time zone,
	"pinned_at" timestamp with time zone,
	"title" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claude_entry" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "claude_entry" ADD COLUMN "thread_seq" integer;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "claude_entry" ADD CONSTRAINT "claude_entry_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claude_entry_thread_id_thread_seq_idx" ON "claude_entry" USING btree ("thread_id","thread_seq") WHERE "claude_entry"."thread_id" is not null;