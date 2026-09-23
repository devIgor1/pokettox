CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`customer` text NOT NULL,
	`mode` text NOT NULL,
	`service` text,
	`quote_id` text,
	`total_cents` integer,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	`paid_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_quote_id_unique` ON `orders` (`quote_id`);--> statement-breakpoint
CREATE INDEX `orders_status_created` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`cep` text NOT NULL,
	`service` text NOT NULL,
	`days` integer,
	`base_cents` integer NOT NULL,
	`insurance_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`declared_cents` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
