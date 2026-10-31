CREATE TABLE "yard_channel" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"post_rule" text DEFAULT 'members' NOT NULL,
	"topic" text,
	CONSTRAINT "yard_channel_name_unique" UNIQUE("name"),
	CONSTRAINT "yard_channel_dm_name_check" CHECK (("yard_channel"."kind" = 'dm') = ("yard_channel"."name" like 'dm:%')),
	CONSTRAINT "yard_channel_kind_check" CHECK (kind in ('channel', 'dm')),
	CONSTRAINT "yard_channel_post_rule_check" CHECK (post_rule in ('members', 'owner'))
);
--> statement-breakpoint
CREATE TABLE "yard_invite" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"for_login" text,
	"made_by" text,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" text,
	"requested_by" text,
	"status" text NOT NULL,
	CONSTRAINT "yard_invite_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "yard_invite_status_check" CHECK (status in ('open', 'redeemed', 'requested', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "yard_member" (
	"channel_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone,
	"user_id" text NOT NULL,
	CONSTRAINT "yard_member_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "yard_message" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel_id" text NOT NULL,
	"decided_at" timestamp with time zone,
	"device" text NOT NULL,
	"kind" text NOT NULL,
	"links" jsonb,
	"login" text NOT NULL,
	"parent_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"text" text NOT NULL,
	"user_id" text,
	CONSTRAINT "yard_message_kind_check" CHECK (kind in ('answer', 'bug', 'fix', 'log', 'notice', 'question', 'steps', 'text')),
	CONSTRAINT "yard_message_status_check" CHECK (status in ('denied', 'pending', 'sent')),
	CONSTRAINT "yard_message_text_check" CHECK (char_length("yard_message"."text") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "yard_rate" (
	"count" integer DEFAULT 0 NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	CONSTRAINT "yard_rate_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "yard_token" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"name" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_id" text NOT NULL,
	CONSTRAINT "yard_token_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "yard_invite" ADD CONSTRAINT "yard_invite_made_by_user_id_fk" FOREIGN KEY ("made_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_invite" ADD CONSTRAINT "yard_invite_redeemed_by_user_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_invite" ADD CONSTRAINT "yard_invite_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_member" ADD CONSTRAINT "yard_member_channel_id_yard_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."yard_channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_member" ADD CONSTRAINT "yard_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_message" ADD CONSTRAINT "yard_message_channel_id_yard_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."yard_channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_message" ADD CONSTRAINT "yard_message_parent_id_yard_message_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."yard_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_message" ADD CONSTRAINT "yard_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_token" ADD CONSTRAINT "yard_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "yard_member_user_idx" ON "yard_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "yard_message_channel_status_at_idx" ON "yard_message" USING btree ("channel_id","status","at");--> statement-breakpoint
CREATE INDEX "yard_message_parent_idx" ON "yard_message" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "yard_message_user_idx" ON "yard_message" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "yard_token_user_name_idx" ON "yard_token" USING btree ("user_id","name");