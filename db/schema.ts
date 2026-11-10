import { pgTable, text, integer, bigint, index } from "drizzle-orm/pg-core";

// Timestamps are Unix milliseconds (Date.now()), so they need BIGINT.
const ms = (name: string) => bigint(name, { mode: "number" });

export const quotes = pgTable("quotes", {
  id:text("id").primaryKey(), owner:text("owner").notNull(), cep:text("cep").notNull(),
  service:text("service").notNull(), days:integer("days"), baseCents:integer("base_cents").notNull(),
  insuranceCents:integer("insurance_cents").notNull(), totalCents:integer("total_cents").notNull(),
  declaredCents:integer("declared_cents").notNull(), expiresAt:ms("expires_at").notNull(),
});
export const orders = pgTable("orders", {
  id:text("id").primaryKey(), idempotencyKey:text("idempotency_key").notNull().unique(),
  fingerprint:text("fingerprint").notNull(), customer:text("customer").notNull(), mode:text("mode").notNull(),
  service:text("service"), quoteId:text("quote_id").unique(), totalCents:integer("total_cents"),
  status:text("status").notNull(), createdAt:ms("created_at").notNull(),
  paidAt:ms("paid_at"), paidBy:text("paid_by"),
}, table => [index("orders_status_created").on(table.status,table.createdAt)]);
export const requestLimits = pgTable("request_limits", { key:text("key").primaryKey(), count:integer("count").notNull(), expiresAt:ms("expires_at").notNull() });

export const orderPayments = pgTable("order_payments", {
  orderId: text("order_id").primaryKey().references(() => orders.id),
  reference: text("reference").notNull().unique(), handle: text("handle").notNull(),
  amountCents: integer("amount_cents").notNull(), checkoutUrl: text("checkout_url"),
  leaseUntil: ms("lease_until").notNull().default(0),
  transactionNsu: text("transaction_nsu").unique(), invoiceSlug: text("invoice_slug"),
  captureMethod: text("capture_method"), paidAt: ms("paid_at"),
  createdAt: ms("created_at").notNull(),
});

export const shipmentJobs = pgTable("shipment_jobs", {
  orderId: text("order_id").primaryKey().references(() => orders.id),
  requestJson: text("request_json").notNull(), maxCents: integer("max_cents").notNull(),
  status: text("status").notNull().default("waiting_payment"),
  superfreteId: text("superfrete_id").unique(), tracking: text("tracking"), printUrl: text("print_url"),
  error: text("error"), leaseUntil: ms("lease_until").notNull().default(0),
  updatedAt: ms("updated_at").notNull(),
});

export const adminAccounts = pgTable("admin_accounts", {
  id: text("id").primaryKey(), email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(), recoveryHash: text("recovery_hash").notNull(),
  active: integer("active").notNull().default(1), version: integer("version").notNull().default(1),
  createdAt: ms("created_at").notNull(),
});
export const adminSessions = pgTable("admin_sessions", {
  tokenHash: text("token_hash").primaryKey(), adminId: text("admin_id").notNull().references(() => adminAccounts.id),
  version: integer("version").notNull(), expiresAt: ms("expires_at").notNull(),
}, table => [index("admin_sessions_expiry").on(table.expiresAt)]);
