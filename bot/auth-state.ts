// Baileys auth state stored in Postgres (table bot_auth) instead of files, so the worker can
// restart or be redeployed on any host without pairing the WhatsApp number again.
import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type SignalDataSet, type SignalDataTypeMap, type SignalKeyStore } from "baileys";
import { database, type Client } from "../lib/pg";

function db(): Client {
  const client = database();
  if (!client) throw new Error("DATABASE_URL is not configured");
  return client;
}
const encode = (value: unknown) => JSON.stringify(value, BufferJSON.replacer);
const decode = (value: string) => JSON.parse(value, BufferJSON.reviver);
const upsert = (key: string, value: unknown) =>
  db().prepare("INSERT INTO bot_auth (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value").bind(key, encode(value));

export async function loadPostgresAuthState() {
  const row = await db().prepare("SELECT value FROM bot_auth WHERE key='creds'").first<{ value: string }>();
  const creds: AuthenticationCreds = row ? decode(row.value) : initAuthCreds();
  const keys: SignalKeyStore = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const out: { [id: string]: SignalDataTypeMap[T] } = {};
      if (!ids.length) return out;
      const names = ids.map(id => `${type}:${id}`);
      const { results } = await db().prepare(`SELECT key,value FROM bot_auth WHERE key IN (${names.map(() => "?").join(",")})`).bind(...names).all<{ key: string; value: string }>();
      for (const r of results) {
        let value = decode(r.value);
        if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
        out[r.key.slice(type.length + 1)] = value;
      }
      return out;
    },
    async set(data: SignalDataSet) {
      const statements = [];
      for (const type in data) {
        const entries = data[type as keyof SignalDataSet] || {};
        for (const id in entries) {
          const value = entries[id];
          statements.push(value ? upsert(`${type}:${id}`, value) : db().prepare("DELETE FROM bot_auth WHERE key=?").bind(`${type}:${id}`));
        }
      }
      for (let i = 0; i < statements.length; i += 100) await db().batch(statements.slice(i, i + 100));
    },
  };
  return {
    state: { creds, keys },
    saveCreds: () => upsert("creds", creds).run().then(() => undefined),
    /** Forgets the session (after a logout); the next start shows a new QR code. */
    clear: () => db().prepare("DELETE FROM bot_auth").run().then(() => undefined),
  };
}
