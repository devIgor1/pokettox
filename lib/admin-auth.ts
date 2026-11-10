import { cookies } from "next/headers";
import { randomToken, tokenHash, validToken } from "./password";
import { database } from "./pg";

export type Admin = { id: string; email: string; version: number };
export const SESSION_SECONDS = 8 * 60 * 60;
const secureCookie = "__Host-pc_staff";
const localCookie = "pc_staff_local";
function authDb() {
  const client = database();
  if (!client) throw new Error("Authentication storage unavailable");
  return client;
}
export function sessionCookie(req: Request, token: string, maxAge = SESSION_SECONDS) {
  const secure = new URL(req.url).protocol === "https:";
  return `${secure ? secureCookie : localCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export async function currentSessionToken() {
  const jar = await cookies();
  // The development cookie is never accepted by a production build.
  return jar.get(secureCookie)?.value || (process.env.NODE_ENV === "development" ? jar.get(localCookie)?.value : undefined);
}
export async function getAdmin(): Promise<Admin | null> {
  const token = await currentSessionToken();
  const client = database();
  if (!token || !validToken(token) || !client) return null;
  return client.prepare(`SELECT a.id, a.email, a.version FROM admin_sessions s
    JOIN admin_accounts a ON a.id=s.admin_id AND a.version=s.version
    WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`)
    .bind(tokenHash(token), Date.now()).first<Admin>();
}
export async function newSession(admin: Admin) {
  const token = randomToken();
  await authDb().prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(Date.now()).run();
  await authDb().prepare("INSERT INTO admin_sessions (token_hash,admin_id,version,expires_at) VALUES (?,?,?,?)")
    .bind(tokenHash(token), admin.id, admin.version, Date.now() + SESSION_SECONDS * 1000).run();
  return token;
}
export async function revokeSession() {
  const token = await currentSessionToken();
  if (token && validToken(token)) await authDb().prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(tokenHash(token)).run();
}
