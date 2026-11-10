// Shared by the site (Next) and the bot worker (bot/). No `next/*` imports here.
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { database, type Client } from "./pg";

export const BOT_ID = "main";
export const POLL_MAX_OPTIONS = 12; // WhatsApp limit
export const VERIFICATION_MINUTES = 30;
export const VERIFICATION_MAX_ATTEMPTS = 5;
/** The worker writes a heartbeat every 30s; older than this means it is offline. */
export const BOT_OFFLINE_AFTER_MS = 2 * 60 * 1000;

export type OutboxKind = "text" | "image" | "poll" | "logout";
export type TextPayload = { text: string; mentionAll?: boolean };
export type ImagePayload = { url: string; caption?: string; mentionAll?: boolean };
export type PollPayload = { pollId: string };
export type OutboxRow = {
  id: string; kind: OutboxKind; chat_jid: string | null; payload: string; status: string;
  attempts: number; send_after: number; message_id: string | null; error: string | null; created_at: number; sent_at: number | null;
};
export type BotStatus = {
  state: string; qr: string | null; phone: string | null; lid: string | null; last_error: string | null;
  heartbeat_at: number; updated_at: number;
};

function client(): Client {
  const c = database();
  if (!c) throw new Error("DATABASE_URL is not configured");
  return c;
}
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest();
export const codeHash = (code: string) => sha256(`pokecofre-phone:${code}`).toString("hex");
/** Phone digits (5511999990000) → WhatsApp user jid. */
export const phoneJid = (phone: string) => `${phone}@s.whatsapp.net`;

type EnqueueOptions = { sendAfter?: number; dedupeKey?: string };
function outboxInsert(kind: OutboxKind, chatJid: string | null, payload: unknown, options: EnqueueOptions = {}) {
  const id = randomUUID(), now = Date.now();
  return {
    id,
    statement: client().prepare(`INSERT INTO bot_outbox (id,kind,chat_jid,payload,dedupe_key,send_after,status,attempts,lease_until,created_at)
      VALUES (?,?,?,?,?,?,'pending',0,0,?) ON CONFLICT (dedupe_key) DO NOTHING`)
      .bind(id, kind, chatJid, JSON.stringify(payload), options.dedupeKey ?? null, options.sendAfter ?? now, now),
  };
}
export async function enqueueText(chatJid: string, payload: TextPayload, options?: EnqueueOptions) {
  const { id, statement } = outboxInsert("text", chatJid, payload, options);
  await statement.run(); return id;
}
export async function enqueueImage(chatJid: string, payload: ImagePayload, options?: EnqueueOptions) {
  const { id, statement } = outboxInsert("image", chatJid, payload, options);
  await statement.run(); return id;
}
export async function enqueueLogout() {
  const { id, statement } = outboxInsert("logout", null, {});
  await statement.run(); return id;
}

/** Validates poll options: 2–12 distinct, non-empty texts (WhatsApp rejects duplicates). */
export function pollOptionsError(name: string, options: string[]) {
  if (!name.trim() || name.length > 255) return "Informe o título da enquete (até 255 caracteres).";
  if (options.length < 2 || options.length > POLL_MAX_OPTIONS) return `A enquete precisa de 2 a ${POLL_MAX_OPTIONS} opções.`;
  if (options.some(o => !o.trim() || o.length > 100)) return "Cada opção precisa ter de 1 a 100 caracteres.";
  if (new Set(options).size !== options.length) return "As opções da enquete não podem se repetir.";
  return null;
}
/** Creates the poll row (with its secret) and the outbox command in one transaction. */
export async function enqueuePoll(chatJid: string, name: string, options: string[], extra: EnqueueOptions & { selectableCount?: number } = {}) {
  const error = pollOptionsError(name, options);
  if (error) throw new Error(error);
  const pollId = randomUUID(), now = Date.now();
  const command = outboxInsert("poll", chatJid, { pollId } satisfies PollPayload, extra);
  await client().batch([
    client().prepare("INSERT INTO polls (id,chat_jid,name,options,selectable_count,secret,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(pollId, chatJid, name, JSON.stringify(options), extra.selectableCount ?? 1, randomBytes(32).toString("base64"), now),
    command.statement,
  ]);
  return { pollId, outboxId: command.id };
}

export async function getBotStatus() {
  return client().prepare("SELECT state,qr,phone,lid,last_error,heartbeat_at,updated_at FROM bot_status WHERE id=?").bind(BOT_ID).first<BotStatus>();
}
export const botOnline = (status: BotStatus | null, now = Date.now()) => Boolean(status && status.state === "open" && now - status.heartbeat_at < BOT_OFFLINE_AFTER_MS);

/** Starts (or restarts) a WhatsApp confirmation; returns the plain code to show to the participant. */
export async function startPhoneVerification(participantId: string, phone: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0"), now = Date.now();
  await client().prepare(`INSERT INTO phone_verifications (participant_id,phone,code_hash,attempts,expires_at,created_at) VALUES (?,?,?,0,?,?)
    ON CONFLICT (participant_id) DO UPDATE SET phone=excluded.phone, code_hash=excluded.code_hash, attempts=0, expires_at=excluded.expires_at, created_at=excluded.created_at`)
    .bind(participantId, phone, codeHash(code), now + VERIFICATION_MINUTES * 60_000, now).run();
  return code;
}
export const verificationMessage = (code: string) => `Meu código PokéCofre é ${code}`;
