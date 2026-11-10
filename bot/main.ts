// PokéCofre WhatsApp worker. Long-running process (not serverless): keeps the WhatsApp
// connection, publishes what the site queues in bot_outbox and records poll votes.
// Run: npm run bot:build && npm run bot:start   (needs DATABASE_URL)
import makeWASocket, {
  BufferJSON, Browsers, DisconnectReason, isJidBroadcast, isJidGroup, isJidNewsletter, isLidUser,
  jidNormalizedUser, makeCacheableSignalKeyStore, normalizeMessageContent, proto, type WAMessage, type WASocket,
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { BOT_ID } from "../lib/bot-shared";
import { database, type Client } from "../lib/pg";
import { loadPostgresAuthState } from "./auth-state";
import { learnLid, phoneOf, resolvePhone } from "./identity";
import { runOnce, sentMessage } from "./outbox";
import type { SentMessage, WhatsAppPort } from "./port";
import { handlePrivateText } from "./verify";
import { recordVote } from "./votes";

const logger = pino({ level: process.env.LOG_LEVEL || "warn" });
const MIN_GAP_MS = 2_000, JITTER_MS = 1_500; // pacing between sends (anti-ban)
function db(): Client {
  const client = database();
  if (!client) throw new Error("DATABASE_URL is not configured");
  return client;
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function setStatus(fields: { state: string; qr?: string | null; phone?: string | null; lid?: string | null; lastError?: string | null }) {
  const now = Date.now();
  await db().prepare(`INSERT INTO bot_status (id,state,qr,phone,lid,last_error,heartbeat_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT (id) DO UPDATE SET state=excluded.state, qr=excluded.qr,
      phone=COALESCE(excluded.phone, bot_status.phone), lid=COALESCE(excluded.lid, bot_status.lid),
      last_error=excluded.last_error, heartbeat_at=excluded.heartbeat_at, updated_at=excluded.updated_at`)
    .bind(BOT_ID, fields.state, fields.qr ?? null, fields.phone ?? null, fields.lid ?? null, fields.lastError ?? null, now, now).run();
}
const heartbeat = () => db().prepare("UPDATE bot_status SET heartbeat_at=? WHERE id=?").bind(Date.now(), BOT_ID).run();

let sock: WASocket | null = null;
let connected = false, stopping = false, restarts = 0;
const memberCache = new Map<string, { at: number; jids: string[] }>();

function adapter(s: WASocket): WhatsAppPort {
  const done = (m: WAMessage | undefined): SentMessage => {
    if (!m?.key.id) throw new Error("WhatsApp não confirmou o envio.");
    return { id: m.key.id, message: m.message ? JSON.stringify(m.message, BufferJSON.replacer) : undefined };
  };
  return {
    sendText: async (jid, text, mentions) => done(await s.sendMessage(jid, { text, mentions })),
    sendImage: async (jid, url, caption, mentions) => done(await s.sendMessage(jid, { image: { url }, caption, mentions })),
    sendPoll: async (jid, poll) => ({ ...done(await s.sendMessage(jid, { poll })), creatorJid: jidNormalizedUser(s.user?.id) }),
    groupMembers: async jid => {
      const cached = memberCache.get(jid);
      if (cached && Date.now() - cached.at < 5 * 60_000) return cached.jids;
      const jids = (await s.groupMetadata(jid)).participants.map(p => p.id);
      memberCache.set(jid, { at: Date.now(), jids });
      return jids;
    },
    logout: () => s.logout(),
  };
}

async function syncGroups(s: WASocket) {
  const groups = Object.values(await s.groupFetchAllParticipating());
  const me = [jidNormalizedUser(s.user?.id), s.user?.lid ? jidNormalizedUser(s.user.lid) : ""];
  const now = Date.now(), statements = [];
  for (const g of groups) {
    const self = g.participants.find(p => me.includes(jidNormalizedUser(p.id)) || (p.phoneNumber && me.includes(jidNormalizedUser(p.phoneNumber))));
    statements.push(db().prepare(`INSERT INTO bot_groups (jid,subject,size,bot_is_admin,addressing_mode,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT (jid) DO UPDATE SET subject=excluded.subject, size=excluded.size, bot_is_admin=excluded.bot_is_admin, addressing_mode=excluded.addressing_mode, updated_at=excluded.updated_at`)
      .bind(g.id, g.subject || "(sem nome)", g.participants.length, self?.admin ? 1 : 0, g.addressingMode ?? null, now));
    memberCache.set(g.id, { at: now, jids: g.participants.map(p => p.id) });
  }
  if (statements.length) await db().batch(statements);
  await db().prepare("DELETE FROM bot_groups WHERE updated_at<?").bind(now).run(); // groups the bot left
  for (const g of groups) for (const p of g.participants) {
    const lid = isLidUser(p.id) ? p.id : p.lid;
    if (lid && p.phoneNumber) await learnLid(lid, p.phoneNumber);
  }
}

async function onMessage(s: WASocket, m: WAMessage) {
  const content = normalizeMessageContent(m.message);
  const chat = m.key.remoteJid;
  if (!content || !chat || isJidBroadcast(chat) || isJidNewsletter(chat)) return;
  const resolver = (lid: string) => s.signalRepository.lidMapping.getPNForLID(lid);
  const update = content.pollUpdateMessage;
  if (update?.vote?.encPayload && update.vote.encIv && update.pollCreationMessageKey?.id && m.key.id) {
    const voters = isJidGroup(chat) ? [m.key.participant, m.key.participantAlt] : [chat, m.key.remoteJidAlt];
    const result = await recordVote({
      pollMessageId: update.pollCreationMessageKey.id, voteMessageId: m.key.id, voterJids: voters,
      encPayload: update.vote.encPayload, encIv: update.vote.encIv,
      votedAt: Number(update.senderTimestampMs || 0) || Number(m.messageTimestamp || 0) * 1000 || Date.now(),
      pushName: m.pushName,
    }, [s.user?.id, s.user?.lid], resolver);
    if (result === "undecryptable") logger.warn({ poll: update.pollCreationMessageKey.id }, "vote could not be decrypted");
    return;
  }
  if (m.key.fromMe || isJidGroup(chat)) return;
  const text = content.conversation || content.extendedTextMessage?.text;
  if (!text) return;
  const reply = await handlePrivateText(await resolvePhone([chat, m.key.remoteJidAlt], resolver), text);
  if (reply) {
    await sleep(800 + Math.random() * 1200);
    await s.sendMessage(chat, { text: reply }, { quoted: m });
  }
}

async function start() {
  connected = false;
  const auth = await loadPostgresAuthState();
  const s = makeWASocket({
    auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) },
    logger, browser: Browsers.ubuntu("PokéCofre"), markOnlineOnConnect: false, syncFullHistory: false,
    shouldIgnoreJid: jid => isJidBroadcast(jid) || isJidNewsletter(jid),
    getMessage: async key => {
      const stored = key.id ? await sentMessage(key.id) : null;
      return stored ? proto.Message.fromObject(JSON.parse(stored, BufferJSON.reviver)) : undefined;
    },
  });
  sock = s;
  s.ev.on("creds.update", auth.saveCreds);
  s.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
    try {
      if (qr) await setStatus({ state: "qr", qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }) });
      if (connection === "connecting") await setStatus({ state: "connecting" });
      if (connection === "open") {
        connected = true; restarts = 0;
        await setStatus({ state: "open", phone: phoneOf(s.user?.id), lid: s.user?.lid ? jidNormalizedUser(s.user.lid) : null });
        await syncGroups(s).catch(error => logger.error({ err: error }, "group sync failed"));
      }
      if (connection === "close") {
        connected = false;
        // This socket is finished: it must not write session data or handle events anymore
        // (a late creds.update would resurrect a session that was just logged out).
        s.ev.removeAllListeners("creds.update");
        s.ev.removeAllListeners("messages.upsert");
        if (sock === s) sock = null;
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        if (stopping) return;
        if (code === DisconnectReason.loggedOut) {
          // Unlinked on the phone (or "Desconectar" in the panel): forget the session and show a new QR.
          await auth.clear();
          await setStatus({ state: "logged_out", lastError: "Número desconectado. Leia o novo QR code para conectar de novo." });
          setTimeout(start, 2_000);
        } else {
          await setStatus({ state: "closed", lastError: lastDisconnect?.error?.message?.slice(0, 300) ?? null });
          setTimeout(start, Math.min(60_000, 2_000 * 2 ** restarts++));
        }
      }
    } catch (error) { logger.error({ err: error }, "connection update handling failed"); }
  });
  s.ev.on("messages.upsert", async ({ messages }) => {
    for (const m of messages) await onMessage(s, m).catch(error => logger.error({ err: error, id: m.key.id }, "message handling failed"));
  });
  s.ev.on("lid-mapping.update", ({ lid, pn }) => { learnLid(lid, pn).catch(error => logger.error({ err: error }, "lid mapping failed")); });
  let pendingSync: NodeJS.Timeout | undefined;
  const scheduleSync = () => { clearTimeout(pendingSync); pendingSync = setTimeout(() => syncGroups(s).catch(error => logger.error({ err: error }, "group sync failed")), 5_000); };
  s.ev.on("groups.upsert", scheduleSync);
  s.ev.on("groups.update", scheduleSync);
  s.ev.on("group-participants.update", ({ id }) => { memberCache.delete(id); scheduleSync(); });
}

async function outboxLoop() {
  while (!stopping) {
    let worked = false;
    if (connected && sock) {
      try { worked = await runOnce(adapter(sock)); } catch (error) { logger.error({ err: error }, "outbox failed"); }
    }
    await sleep(worked ? MIN_GAP_MS + Math.random() * JITTER_MS : 3_000);
  }
}

async function main() {
  if (!database()) throw new Error("DATABASE_URL is not configured");
  await setStatus({ state: "starting" });
  await start();
  setInterval(() => { heartbeat().catch(error => logger.error({ err: error }, "heartbeat failed")); }, 30_000);
  setInterval(() => { if (connected && sock) syncGroups(sock).catch(error => logger.error({ err: error }, "group sync failed")); }, 10 * 60_000);
  void outboxLoop();
  const stop = async () => {
    stopping = true;
    try { await setStatus({ state: "closed", lastError: "Robô reiniciando." }); } finally { sock?.end(undefined); process.exit(0); }
  };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
}
main().catch(error => { logger.fatal({ err: error }, "bot failed to start"); process.exit(1); });
