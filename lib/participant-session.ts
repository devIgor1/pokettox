// Participant (buyer) sessions. Kept free of `next/*` imports so route handlers stay
// testable outside the Next runtime: routes read the cookie from the Request, pages
// use lib/participant-auth.ts (which reads it through next/headers).
import { randomToken, tokenHash, validToken } from "./password";
import { database } from "./pg";
import { AppError, db } from "./server";

export type Participant = {
  id: string; email: string; name: string | null; cpf: string | null;
  phone: string | null; pending_phone: string | null; status: string; version: number;
};
export const PARTICIPANT_SESSION_SECONDS = 30 * 24 * 60 * 60;
export const secureParticipantCookie = "__Host-pc_conta";
export const localParticipantCookie = "pc_conta_local";
const columns = "p.id, p.email, p.name, p.cpf, p.phone, p.pending_phone, p.status, p.version";

// SameSite=Lax (not Strict like the staff cookie): participants arrive from links sent on
// WhatsApp, a cross-site navigation, and must land signed in. State-changing requests are
// still protected by the strict Origin check in every POST/PATCH/DELETE handler.
export function participantCookie(req: Request, token: string, maxAge = PARTICIPANT_SESSION_SECONDS) {
  const secure = new URL(req.url).protocol === "https:";
  return `${secure ? secureParticipantCookie : localParticipantCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export function pickSessionToken(read: (name: string) => string | undefined) {
  // The development cookie is never accepted by a production build.
  return read(secureParticipantCookie) || (process.env.NODE_ENV === "development" ? read(localParticipantCookie) : undefined);
}
export function requestSessionToken(req: Request) {
  const jar = new Map<string, string>();
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return pickSessionToken(name => jar.get(name));
}
export async function participantByToken(token: string | undefined): Promise<Participant | null> {
  const client = database();
  if (!token || !validToken(token) || !client) return null;
  return client.prepare(`SELECT ${columns} FROM participant_sessions s
    JOIN participants p ON p.id=s.participant_id AND p.version=s.version
    WHERE s.token_hash=? AND s.expires_at>? AND p.email IS NOT NULL`)
    .bind(tokenHash(token), Date.now()).first<Participant>();
}
export async function requireParticipant(req: Request) {
  const participant = await participantByToken(requestSessionToken(req));
  if (!participant) throw new AppError("Entre na sua conta para continuar.", 401);
  return participant;
}
export async function newParticipantSession(participant: { id: string; version: number }) {
  const token = randomToken();
  await db().prepare("DELETE FROM participant_sessions WHERE expires_at <= ?").bind(Date.now()).run();
  await db().prepare("INSERT INTO participant_sessions (token_hash,participant_id,version,expires_at) VALUES (?,?,?,?)")
    .bind(tokenHash(token), participant.id, participant.version, Date.now() + PARTICIPANT_SESSION_SECONDS * 1000).run();
  return token;
}
export async function revokeParticipantSession(req: Request) {
  const token = requestSessionToken(req);
  if (token && validToken(token)) await db().prepare("DELETE FROM participant_sessions WHERE token_hash=?").bind(tokenHash(token)).run();
}
