import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";

// OWASP scrypt profile: 32 MiB, N=2^15, r=8, p=3. Never store plain passwords.
const parameters = { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
const prefix = "scrypt$32768$8$3";
export const randomToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const validToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, parameters, (error, key) => error ? reject(error) : resolve(key));
  });
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${prefix}$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts.slice(0, 4).join("$") !== prefix || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{64}$/.test(parts[5])) return false;
  const actual = await derive(password, parts[4]);
  return timingSafeEqual(actual, Buffer.from(parts[5], "hex"));
}
export function matchesToken(value: string, expectedHash: string) {
  if (!validToken(value) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(tokenHash(value), "hex"), Buffer.from(expectedHash, "hex"));
}
// The same work for unknown emails; this value cannot authenticate any account.
export const dummyPasswordHash = `${prefix}$${"0".repeat(32)}$${"0".repeat(64)}`;
