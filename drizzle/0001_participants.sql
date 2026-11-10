CREATE TABLE "addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"label" text NOT NULL,
	"recipient" text NOT NULL,
	"cep" text NOT NULL,
	"street" text NOT NULL,
	"number" text NOT NULL,
	"complement" text DEFAULT '' NOT NULL,
	"district" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"is_default" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participant_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"version" integer NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"password_hash" text,
	"name" text,
	"cpf" text,
	"phone" text,
	"pending_phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"terms_accepted_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "participants_email_unique" UNIQUE("email"),
	CONSTRAINT "participants_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_participant" ON "addresses" USING btree ("participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_one_default" ON "addresses" USING btree ("participant_id") WHERE "addresses"."is_default" = 1;--> statement-breakpoint
CREATE INDEX "participant_sessions_expiry" ON "participant_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "participant_sessions_participant" ON "participant_sessions" USING btree ("participant_id");