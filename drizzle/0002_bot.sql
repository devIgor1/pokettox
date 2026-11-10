CREATE TABLE "bot_auth" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_groups" (
	"jid" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"size" integer NOT NULL,
	"bot_is_admin" integer DEFAULT 0 NOT NULL,
	"addressing_mode" text,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"chat_jid" text,
	"payload" text NOT NULL,
	"dedupe_key" text,
	"send_after" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" bigint DEFAULT 0 NOT NULL,
	"message_id" text,
	"error" text,
	"sent_message" text,
	"created_at" bigint NOT NULL,
	"sent_at" bigint,
	CONSTRAINT "bot_outbox_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "bot_status" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"qr" text,
	"phone" text,
	"lid" text,
	"last_error" text,
	"heartbeat_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jid_map" (
	"lid" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_verifications" (
	"participant_id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_vote_events" (
	"id" text PRIMARY KEY NOT NULL,
	"poll_id" text NOT NULL,
	"vote_message_id" text NOT NULL,
	"voter_jid" text NOT NULL,
	"voter_phone" text,
	"participant_id" text,
	"selected" text NOT NULL,
	"voted_at" bigint NOT NULL,
	"received_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_jid" text NOT NULL,
	"name" text NOT NULL,
	"options" text NOT NULL,
	"selectable_count" integer DEFAULT 1 NOT NULL,
	"secret" text NOT NULL,
	"message_id" text,
	"creator_jid" text,
	"created_at" bigint NOT NULL,
	"sent_at" bigint,
	"closed_at" bigint,
	CONSTRAINT "polls_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_vote_events" ADD CONSTRAINT "poll_vote_events_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_vote_events" ADD CONSTRAINT "poll_vote_events_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_outbox_due" ON "bot_outbox" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "phone_verifications_phone" ON "phone_verifications" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_vote_events_message" ON "poll_vote_events" USING btree ("poll_id","vote_message_id");--> statement-breakpoint
CREATE INDEX "poll_vote_events_poll_time" ON "poll_vote_events" USING btree ("poll_id","voted_at");--> statement-breakpoint
CREATE INDEX "poll_vote_events_voter" ON "poll_vote_events" USING btree ("voter_jid");