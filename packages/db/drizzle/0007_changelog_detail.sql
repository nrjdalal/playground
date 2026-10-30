ALTER TABLE "changelog_entry" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "changelog_entry" ADD COLUMN "images" jsonb DEFAULT '[]'::jsonb NOT NULL;