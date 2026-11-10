CREATE TABLE "admin_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"recovery_hash" text NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "admin_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"version" integer NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_payments" (
	"order_id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"handle" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"checkout_url" text,
	"lease_until" bigint DEFAULT 0 NOT NULL,
	"transaction_nsu" text,
	"invoice_slug" text,
	"capture_method" text,
	"paid_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "order_payments_reference_unique" UNIQUE("reference"),
	CONSTRAINT "order_payments_transaction_nsu_unique" UNIQUE("transaction_nsu")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"customer" text NOT NULL,
	"mode" text NOT NULL,
	"service" text,
	"quote_id" text,
	"total_cents" integer,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"paid_at" bigint,
	"paid_by" text,
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "orders_quote_id_unique" UNIQUE("quote_id")
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"cep" text NOT NULL,
	"service" text NOT NULL,
	"days" integer,
	"base_cents" integer NOT NULL,
	"insurance_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"declared_cents" integer NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_jobs" (
	"order_id" text PRIMARY KEY NOT NULL,
	"request_json" text NOT NULL,
	"max_cents" integer NOT NULL,
	"status" text DEFAULT 'waiting_payment' NOT NULL,
	"superfrete_id" text,
	"tracking" text,
	"print_url" text,
	"error" text,
	"lease_until" bigint DEFAULT 0 NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "shipment_jobs_superfrete_id_unique" UNIQUE("superfrete_id")
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admin_accounts_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_jobs" ADD CONSTRAINT "shipment_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_expiry" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "orders_status_created" ON "orders" USING btree ("status","created_at");