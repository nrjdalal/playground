ALTER TABLE "yard_channel" DROP CONSTRAINT "yard_channel_kind_check";--> statement-breakpoint
ALTER TABLE "yard_channel" ADD CONSTRAINT "yard_channel_self_name_check" CHECK (("yard_channel"."kind" = 'self') = ("yard_channel"."name" like 'self:%'));--> statement-breakpoint
ALTER TABLE "yard_channel" ADD CONSTRAINT "yard_channel_kind_check" CHECK (kind in ('channel', 'dm', 'self'));