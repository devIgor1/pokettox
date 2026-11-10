// Who is behind a WhatsApp id. Groups often expose LIDs (opaque ids) instead of phone numbers;
// jid_map keeps what the worker learns (from group metadata and Baileys' LID mapping events).
import { isLidUser, isPnUser, jidDecode, jidNormalizedUser } from "baileys";
import { randomUUID } from "node:crypto";
import { database, type Client } from "../lib/pg";

function db(): Client {
  const client = database();
  if (!client) throw new Error("DATABASE_URL is not configured");
  return client;
}
/** Optional live lookup (Baileys' signal repository) for LIDs not yet in jid_map. */
export type LidResolver = (lid: string) => Promise<string | null | undefined>;

const userOf = (jid: string) => jidDecode(jid)?.user || null;
/** Phone digits from a phone-number jid (device suffix removed). */
export const phoneOf = (jid: string | null | undefined) => jid && isPnUser(jid) ? userOf(jidNormalizedUser(jid)) : null;

export async function resolvePhone(jids: (string | null | undefined)[], resolver?: LidResolver) {
  for (const jid of jids) { const phone = phoneOf(jid); if (phone) return phone; }
  for (const jid of jids) {
    if (!jid || !isLidUser(jid)) continue;
    const lid = jidNormalizedUser(jid);
    const known = await db().prepare("SELECT phone FROM jid_map WHERE lid=?").bind(lid).first<{ phone: string }>();
    if (known) return known.phone;
    const live = phoneOf(await resolver?.(lid));
    if (live) { await learnLid(lid, live); return live; }
  }
  return null;
}

/** Participant for a phone; created on first sight (bot-made profile, no site account yet). */
export async function participantForPhone(phone: string, name?: string | null) {
  const now = Date.now();
  const row = await db().prepare(`INSERT INTO participants (id,phone,name,status,version,created_at,updated_at) VALUES (?,?,?,'active',1,?,?)
    ON CONFLICT (phone) DO UPDATE SET name=COALESCE(participants.name, excluded.name) RETURNING id`)
    .bind(randomUUID(), phone, name?.trim().slice(0, 150) || null, now, now).first<{ id: string }>();
  return row!.id;
}

/** Records lid → phone and fills in votes that arrived before the number was known. */
export async function learnLid(lidJid: string, phoneOrJid: string) {
  const lid = jidNormalizedUser(lidJid), phone = phoneOrJid.includes("@") ? phoneOf(phoneOrJid) : phoneOrJid;
  if (!isLidUser(lid) || !phone || !/^\d{8,15}$/.test(phone)) return;
  const now = Date.now();
  const changed = await db().prepare(`INSERT INTO jid_map (lid,phone,updated_at) VALUES (?,?,?)
    ON CONFLICT (lid) DO UPDATE SET phone=excluded.phone, updated_at=excluded.updated_at WHERE jid_map.phone<>excluded.phone`)
    .bind(lid, phone, now).run();
  const pending = await db().prepare("SELECT 1 AS x FROM poll_vote_events WHERE voter_jid=? AND voter_phone IS NULL LIMIT 1").bind(lid).first();
  if (!pending && !changed.meta.changes) return;
  if (pending) {
    const participantId = await participantForPhone(phone);
    await db().prepare("UPDATE poll_vote_events SET voter_phone=?, participant_id=? WHERE voter_jid=? AND voter_phone IS NULL").bind(phone, participantId, lid).run();
  }
}
