import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const quotes = sqliteTable("quotes", {
  id:text("id").primaryKey(), owner:text("owner").notNull(), cep:text("cep").notNull(),
  service:text("service").notNull(), days:integer("days"), baseCents:integer("base_cents").notNull(),
  insuranceCents:integer("insurance_cents").notNull(), totalCents:integer("total_cents").notNull(),
  declaredCents:integer("declared_cents").notNull(), expiresAt:integer("expires_at").notNull(),
});
export const orders = sqliteTable("orders", {
  id:text("id").primaryKey(), idempotencyKey:text("idempotency_key").notNull().unique(),
  fingerprint:text("fingerprint").notNull(), customer:text("customer").notNull(), mode:text("mode").notNull(),
  service:text("service"), quoteId:text("quote_id").unique(), totalCents:integer("total_cents"),
  status:text("status").notNull(), createdAt:integer("created_at").notNull(),
  paidAt:integer("paid_at"), paidBy:text("paid_by"),
}, table => [index("orders_status_created").on(table.status,table.createdAt)]);
export const requestLimits = sqliteTable("request_limits", { key:text("key").primaryKey(), count:integer("count").notNull(), expiresAt:integer("expires_at").notNull() });
