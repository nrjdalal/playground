CREATE TABLE "changelog_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"link" text,
	"source_key" text,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "changelog_entry_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "changelog_seen" (
	"user_id" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changelog_seen" ADD CONSTRAINT "changelog_seen_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changelog_entry_at_idx" ON "changelog_entry" USING btree ("at" DESC NULLS LAST);