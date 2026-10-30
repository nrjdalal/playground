CREATE TABLE "inbox_item" (
	"answer" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivery" jsonb,
	"from" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"preview" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"ref" integer GENERATED ALWAYS AS IDENTITY (sequence name "inbox_item_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"status" text NOT NULL,
	"title" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inbox_item_ref_unique" UNIQUE("ref")
);
