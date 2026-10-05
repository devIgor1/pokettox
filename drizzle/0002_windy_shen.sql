CREATE TABLE `order_payments` (
	`order_id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`handle` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`checkout_url` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`transaction_nsu` text,
	`invoice_slug` text,
	`capture_method` text,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_payments_reference_unique` ON `order_payments` (`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_payments_transaction_nsu_unique` ON `order_payments` (`transaction_nsu`);--> statement-breakpoint
CREATE TABLE `shipment_jobs` (
	`order_id` text PRIMARY KEY NOT NULL,
	`request_json` text NOT NULL,
	`max_cents` integer NOT NULL,
	`status` text DEFAULT 'waiting_payment' NOT NULL,
	`superfrete_id` text,
	`tracking` text,
	`print_url` text,
	`error` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipment_jobs_superfrete_id_unique` ON `shipment_jobs` (`superfrete_id`);