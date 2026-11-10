// Poll votes. Baileys 7 no longer decrypts them automatically, so the worker does it with the
// secret it generated for each poll (table polls) and stores every change (poll_vote_events).
import { decryptPollVote, jidNormalizedUser } from "baileys";
import { randomUUID } from "node:crypto";
import { database, type Client } from "../lib/pg";
import { sha256 } from "../lib/bot-shared";
import { participantForPhone, resolvePhone, type LidResolver } from "./identity";

function db(): Client {
  const client = database();
  if (!client) throw new Error("DATABASE_URL is not configured");
  return client;
}
export type VoteInput = {
  pollMessageId: string;          // pollUpdateMessage.pollCreationMessageKey.id
  voteMessageId: string;          // key.id of the vote message (new for every change)
  voterJids: (string | null | undefined)[]; // key.participant / key.participantAlt (group) or remoteJid / remoteJidAlt
  encPayload: Uint8Array; encIv: Uint8Array;
  votedAt: number;                // senderTimestampMs, or message timestamp
  pushName?: string | null;
};
export type VoteResult = "recorded" | "duplicate" | "unknown_poll" | "undecryptable";
type PollRow = { id: string; options: string; secret: string; creator_jid: string | null };

const unique = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => Boolean(v)).map(v => jidNormalizedUser(v)))];

/**
 * Decrypts a vote. The signature includes the creator and voter ids exactly as the voter's phone
 * saw them, which may be the phone-number form or the LID form, so every combination is tried.
 * Returns the chosen option texts (empty = vote removed), or null if no combination works.
 */
export function decryptVote(poll: { options: string[]; secret: Uint8Array }, pollMessageId: string, creatorJids: string[], voterJids: string[], enc: { encPayload: Uint8Array; encIv: Uint8Array }) {
  for (const creator of creatorJids) for (const voter of voterJids) {
    try {
      const vote = decryptPollVote(enc, { pollCreatorJid: creator, pollMsgId: pollMessageId, pollEncKey: poll.secret, voterJid: voter });
      const hashes = (vote.selectedOptions || []).map(h => Buffer.from(h).toString("hex"));
      return poll.options.filter(option => hashes.includes(sha256(option).toString("hex")));
    } catch { /* wrong combination: authentication tag mismatch */ }
  }
  return null;
}

export async function recordVote(input: VoteInput, botJids: (string | null | undefined)[], resolver?: LidResolver): Promise<VoteResult> {
  const poll = await db().prepare("SELECT id,options,secret,creator_jid FROM polls WHERE message_id=?").bind(input.pollMessageId).first<PollRow>();
  if (!poll) return "unknown_poll";
  const voters = unique(input.voterJids);
  const selected = decryptVote({ options: JSON.parse(poll.options), secret: Buffer.from(poll.secret, "base64") }, input.pollMessageId, unique([poll.creator_jid, ...botJids]), voters, input);
  if (!selected) return "undecryptable";
  const phone = await resolvePhone(voters, resolver);
  const participantId = phone ? await participantForPhone(phone, input.pushName) : null;
  // The stable id is the LID when there is one (it does not change if the person changes number).
  const voterJid = voters.find(j => j.endsWith("@lid")) || voters[0];
  const result = await db().prepare(`INSERT INTO poll_vote_events (id,poll_id,vote_message_id,voter_jid,voter_phone,participant_id,selected,voted_at,received_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (poll_id,vote_message_id) DO NOTHING`)
    .bind(randomUUID(), poll.id, input.voteMessageId, voterJid, phone, participantId, JSON.stringify(selected), input.votedAt, Date.now()).run();
  return result.meta.changes ? "recorded" : "duplicate";
}
