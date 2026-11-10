// WhatsApp confirmation: the participant sends the code shown on the site to the bot. Receiving
// it from the number proves ownership and links the group votes of that number to the account.
import { database, type Client } from "../lib/pg";
import { VERIFICATION_MAX_ATTEMPTS, codeHash } from "../lib/bot-shared";

function db(): Client {
  const client = database();
  if (!client) throw new Error("DATABASE_URL is not configured");
  return client;
}
type Pending = { participant_id: string; code_hash: string; attempts: number };
type Holder = { id: string; email: string | null };

export const replies = {
  unknownNumber: "Não consegui identificar o seu número. Confira se você está enviando do WhatsApp cadastrado no site.",
  invalid: "Código inválido ou expirado. Gere um novo código em Minha conta, no site, e envie aqui de novo.",
  taken: "Este número já está confirmado em outra conta. Fale com a administração do grupo para resolver.",
  done: (name: string | null) => `✅ Pronto${name ? `, ${name.split(" ")[0]}` : ""}! Seu WhatsApp foi confirmado na sua conta PokéCofre. Seus lances no grupo agora aparecem lá.`,
};

/** Handles a private text message. Returns the reply to send, or null to stay silent. */
export async function handlePrivateText(senderPhone: string | null, text: string, now = Date.now()): Promise<string | null> {
  const code = /(?<!\d)(\d{6})(?!\d)/.exec(text)?.[1];
  if (!code) return null;
  if (!senderPhone) return replies.unknownNumber;
  const { results: pending } = await db().prepare("SELECT participant_id,code_hash,attempts FROM phone_verifications WHERE phone=? AND expires_at>?")
    .bind(senderPhone, now).all<Pending>();
  const match = pending.find(p => p.code_hash === codeHash(code));
  if (!match) {
    if (pending.length) await db().batch([
      db().prepare("UPDATE phone_verifications SET attempts=attempts+1 WHERE phone=? AND expires_at>?").bind(senderPhone, now),
      db().prepare("DELETE FROM phone_verifications WHERE phone=? AND attempts>=?").bind(senderPhone, VERIFICATION_MAX_ATTEMPTS),
    ]);
    return replies.invalid;
  }
  const accountId = match.participant_id;
  const holder = await db().prepare("SELECT id,email FROM participants WHERE phone=?").bind(senderPhone).first<Holder>();
  if (holder && holder.id !== accountId && holder.email) {
    await db().prepare("DELETE FROM phone_verifications WHERE participant_id=?").bind(accountId).run();
    return replies.taken;
  }
  const statements = [];
  if (holder && holder.id !== accountId) {
    // The bot already created a profile for this number (from votes). Fold it into the account:
    // its history moves over and a block on the number stays in force.
    const stub = holder.id;
    statements.push(
      db().prepare("UPDATE poll_vote_events SET participant_id=? WHERE participant_id=?").bind(accountId, stub),
      db().prepare(`UPDATE participants a SET
          status=CASE WHEN s.status='blocked' THEN 'blocked' ELSE a.status END,
          notes=NULLIF(CONCAT_WS(E'\\n', a.notes, s.notes), ''),
          name=COALESCE(a.name, s.name)
        FROM participants s WHERE a.id=? AND s.id=? AND s.email IS NULL`).bind(accountId, stub),
      db().prepare("DELETE FROM participants WHERE id=? AND email IS NULL").bind(stub),
    );
  }
  statements.push(
    db().prepare("UPDATE participants SET phone=?, pending_phone=NULL, updated_at=? WHERE id=?").bind(senderPhone, now, accountId),
    db().prepare("DELETE FROM phone_verifications WHERE participant_id=?").bind(accountId),
  );
  await db().batch(statements);
  const account = await db().prepare("SELECT name FROM participants WHERE id=?").bind(accountId).first<{ name: string | null }>();
  return replies.done(account?.name ?? null);
}
