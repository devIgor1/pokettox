// Executes commands queued by the site (bot_outbox). One command per call; the caller paces sends.
import { database, type Client } from "../lib/pg";
import type { ImagePayload, OutboxRow, PollPayload, TextPayload } from "../lib/bot-shared";
import type { WhatsAppPort } from "./port";

export const LEASE_MS = 90_000;
export const MAX_ATTEMPTS = 5;
function db(): Client {
  const client = database();
  if (!client) throw new Error("DATABASE_URL is not configured");
  return client;
}

/** Takes the next due command. Expired leases (worker died mid-send) are taken again. */
export async function claimNext(now = Date.now()) {
  return db().prepare(`UPDATE bot_outbox SET status='sending', lease_until=?, attempts=attempts+1
    WHERE id=(SELECT id FROM bot_outbox WHERE (status='pending' AND send_after<=?) OR (status='sending' AND lease_until<?)
      ORDER BY send_after, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id,kind,chat_jid,payload,status,attempts,send_after,message_id,error,created_at,sent_at`)
    .bind(now + LEASE_MS, now, now).first<OutboxRow>();
}

type PollRow = { id: string; name: string; options: string; selectable_count: number; secret: string; message_id: string | null };

async function execute(port: WhatsAppPort, row: OutboxRow): Promise<{ id: string | null; message?: string }> {
  const jid = row.chat_jid || "";
  const mentionsFor = async (all?: boolean) => all ? port.groupMembers(jid) : undefined;
  if (row.kind === "text") {
    const p = JSON.parse(row.payload) as TextPayload;
    return port.sendText(jid, p.text, await mentionsFor(p.mentionAll));
  }
  if (row.kind === "image") {
    const p = JSON.parse(row.payload) as ImagePayload;
    return port.sendImage(jid, p.url, p.caption, await mentionsFor(p.mentionAll));
  }
  if (row.kind === "poll") {
    const { pollId } = JSON.parse(row.payload) as PollPayload;
    const poll = await db().prepare("SELECT id,name,options,selectable_count,secret,message_id FROM polls WHERE id=?").bind(pollId).first<PollRow>();
    if (!poll) throw new Error("Enquete não encontrada.");
    // Never publish the same poll twice (e.g. the worker died after sending, before marking it sent).
    if (poll.message_id) return { id: poll.message_id };
    const sent = await port.sendPoll(jid, { name: poll.name, values: JSON.parse(poll.options), selectableCount: poll.selectable_count, messageSecret: Buffer.from(poll.secret, "base64") });
    await db().prepare("UPDATE polls SET message_id=?, creator_jid=?, sent_at=? WHERE id=? AND message_id IS NULL").bind(sent.id, sent.creatorJid, Date.now(), poll.id).run();
    return sent;
  }
  if (row.kind === "logout") { await port.logout(); return { id: null }; }
  throw new Error(`Tipo de comando desconhecido: ${row.kind}`);
}

/** Runs one due command. Returns false when there was nothing to do. */
export async function runOnce(port: WhatsAppPort, now = Date.now()) {
  const row = await claimNext(now);
  if (!row) return false;
  try {
    const sent = await execute(port, row);
    await db().prepare("UPDATE bot_outbox SET status='sent', message_id=?, sent_message=?, sent_at=?, error=NULL, lease_until=0 WHERE id=? AND status='sending'")
      .bind(sent.id, sent.message ?? null, Date.now(), row.id).run();
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const final = row.attempts >= MAX_ATTEMPTS;
    // Exponential backoff: 20s, 40s, 80s, 160s.
    await db().prepare("UPDATE bot_outbox SET status=?, error=?, send_after=?, lease_until=0 WHERE id=? AND status='sending'")
      .bind(final ? "failed" : "pending", message, Date.now() + 10_000 * 2 ** row.attempts, row.id).run();
  }
  return true;
}

/** Message the bot sent, for Baileys' getMessage (WhatsApp asks for it to re-encrypt for a device). */
export async function sentMessage(messageId: string) {
  const row = await db().prepare("SELECT sent_message FROM bot_outbox WHERE message_id=? AND sent_message IS NOT NULL").bind(messageId).first<{ sent_message: string }>();
  return row?.sent_message ?? null;
}
