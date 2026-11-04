ALTER TABLE "user" ADD COLUMN "login" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_login_unique" UNIQUE("login");