CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"value" jsonb NOT NULL
);
