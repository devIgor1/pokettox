import { pgTable, text, integer, bigint, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

// ---- Participants (group members / buyers) ----
// A participant may exist before having a site account: the bot creates one from the
// WhatsApp number on the first vote. Email/password are filled when the person signs up.
export const participants = pgTable("participants", {
  id: text("id").primaryKey(),
  email: text("email").unique(), passwordHash: text("password_hash"),
  name: text("name"), cpf: text("cpf"),
  // Verified WhatsApp number (digits with country code, e.g. 5511999990000). Set only after
  // the bot confirms ownership; until then the informed number stays in pending_phone.
  phone: text("phone").unique(), pendingPhone: text("pending_phone"),
  status: text("status").notNull().default("active"), // active | blocked
  notes: text("notes"),
  version: integer("version").notNull().default(1),
  termsAcceptedAt: ms("terms_accepted_at"),
  createdAt: ms("created_at").notNull(), updatedAt: ms("updated_at").notNull(),
});
export const participantSessions = pgTable("participant_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  participantId: text("participant_id").notNull().references(() => participants.id),
  version: integer("version").notNull(), expiresAt: ms("expires_at").notNull(),
}, table => [index("participant_sessions_expiry").on(table.expiresAt), index("participant_sessions_participant").on(table.participantId)]);
export const addresses = pgTable("addresses", {
  id: text("id").primaryKey(),
  participantId: text("participant_id").notNull().references(() => participants.id),
  label: text("label").notNull(), recipient: text("recipient").notNull(),
  cep: text("cep").notNull(), street: text("street").notNull(), number: text("number").notNull(),
  complement: text("complement").notNull().default(""), district: text("district").notNull(),
  city: text("city").notNull(), state: text("state").notNull(),
  isDefault: integer("is_default").notNull().default(0),
  createdAt: ms("created_at").notNull(), updatedAt: ms("updated_at").notNull(),
}, table => [
  index("addresses_participant").on(table.participantId),
  uniqueIndex("addresses_one_default").on(table.participantId).where(sql`${table.isDefault} = 1`),
]);

// ---- WhatsApp bot (worker in bot/) ----
// Baileys session (creds + signal keys), serialized with BufferJSON. Lets the worker restart
// or redeploy without pairing the number again.
export const botAuth = pgTable("bot_auth", { key: text("key").primaryKey(), value: text("value").notNull() });
// Single row (id 'main') written by the worker and read by the staff panel.
export const botStatus = pgTable("bot_status", {
  id: text("id").primaryKey(),
  state: text("state").notNull(), // starting | qr | connecting | open | closed | logged_out
  qr: text("qr"), // data: URL of the pairing QR code while state = qr
  phone: text("phone"), lid: text("lid"), lastError: text("last_error"),
  heartbeatAt: ms("heartbeat_at").notNull(), updatedAt: ms("updated_at").notNull(),
});
export const botGroups = pgTable("bot_groups", {
  jid: text("jid").primaryKey(), subject: text("subject").notNull(), size: integer("size").notNull(),
  botIsAdmin: integer("bot_is_admin").notNull().default(0), addressingMode: text("addressing_mode"),
  updatedAt: ms("updated_at").notNull(),
});
// WhatsApp hides phone numbers behind LIDs in many groups; this maps them back (lid jid → phone digits).
export const jidMap = pgTable("jid_map", { lid: text("lid").primaryKey(), phone: text("phone").notNull(), updatedAt: ms("updated_at").notNull() });
// Commands from the site to the worker (send text/image/poll, logout). Leased like shipment_jobs.
export const botOutbox = pgTable("bot_outbox", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), chatJid: text("chat_jid"),
  payload: text("payload").notNull(), dedupeKey: text("dedupe_key").unique(),
  sendAfter: ms("send_after").notNull(), status: text("status").notNull().default("pending"), // pending | sending | sent | failed
  attempts: integer("attempts").notNull().default(0), leaseUntil: ms("lease_until").notNull().default(0),
  messageId: text("message_id"), error: text("error"),
  // The sent message (proto JSON) so the worker can answer WhatsApp re-send requests (getMessage).
  sentMessage: text("sent_message"),
  createdAt: ms("created_at").notNull(), sentAt: ms("sent_at"),
}, table => [index("bot_outbox_due").on(table.status, table.sendAfter)]);
// Polls the bot created. The secret is generated here (not by Baileys) so votes can always be decrypted.
export const polls = pgTable("polls", {
  id: text("id").primaryKey(), chatJid: text("chat_jid").notNull(), name: text("name").notNull(),
  options: text("options").notNull(), // JSON array of option texts
  selectableCount: integer("selectable_count").notNull().default(1),
  secret: text("secret").notNull(), // base64, 32 bytes
  messageId: text("message_id").unique(), creatorJid: text("creator_jid"),
  createdAt: ms("created_at").notNull(), sentAt: ms("sent_at"), closedAt: ms("closed_at"),
});
// Append-only log of every vote change (an empty selection = vote removed). Proof for disputes.
export const pollVoteEvents = pgTable("poll_vote_events", {
  id: text("id").primaryKey(), pollId: text("poll_id").notNull().references(() => polls.id),
  voteMessageId: text("vote_message_id").notNull(), voterJid: text("voter_jid").notNull(),
  voterPhone: text("voter_phone"), participantId: text("participant_id").references(() => participants.id),
  selected: text("selected").notNull(), // JSON array of option texts
  votedAt: ms("voted_at").notNull(), receivedAt: ms("received_at").notNull(),
}, table => [
  uniqueIndex("poll_vote_events_message").on(table.pollId, table.voteMessageId),
  index("poll_vote_events_poll_time").on(table.pollId, table.votedAt),
  index("poll_vote_events_voter").on(table.voterJid),
]);
// Pending WhatsApp confirmations: the participant sends this code to the bot from their number.
export const phoneVerifications = pgTable("phone_verifications", {
  participantId: text("participant_id").primaryKey().references(() => participants.id),
  phone: text("phone").notNull(), codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0), expiresAt: ms("expires_at").notNull(), createdAt: ms("created_at").notNull(),
}, table => [index("phone_verifications_phone").on(table.phone)]);
