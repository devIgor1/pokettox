// Postgres (Neon) access with the same small surface the app used with D1:
// db().prepare(sql).bind(...).first()/all()/run() and db().batch([...]).
// Queries keep `?` placeholders; they are rewritten to `$1, $2...` here.
// Transport is Neon's HTTP driver (serverless-friendly, no TCP pool to manage).
import { neon, types, type NeonQueryFunction } from "@neondatabase/serverless";

// Timestamps are milliseconds in BIGINT columns and COUNT/SUM return int8/numeric.
// Postgres sends those as strings; the app expects plain numbers (all values
// stay far below Number.MAX_SAFE_INTEGER).
const INT8 = 20, NUMERIC = 1700;
const typeParsers = {
  getTypeParser: (id: number, format?: "text" | "binary") =>
    id === INT8 || id === NUMERIC ? (value: string) => Number(value) : types.getTypeParser(id, format),
};

export type RunResult<T = Record<string, unknown>> = { results: T[]; meta: { changes: number } };

function toPostgres(query: string) {
  let index = 0, out = "", quote: string | null = null;
  for (const char of query) {
    if (quote) { if (char === quote) quote = null; out += char; continue; }
    if (char === "'" || char === '"') { quote = char; out += char; continue; }
    out += char === "?" ? `$${++index}` : char;
  }
  return out;
}

export class Statement {
  constructor(private client: Client, readonly text: string, readonly params: unknown[] = []) {}
  bind(...params: unknown[]) { return new Statement(this.client, this.text, params); }
  async run<T = Record<string, unknown>>(): Promise<RunResult<T>> {
    const result = await this.client.sql.query(this.text, this.params, { fullResults: true, types: typeParsers });
    return { results: result.rows as T[], meta: { changes: result.rowCount ?? 0 } };
  }
  all<T = Record<string, unknown>>() { return this.run<T>(); }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (await this.run<T>()).results[0] ?? null;
  }
}

export class Client {
  readonly sql: NeonQueryFunction<false, false>;
  // Note: in driver 1.2 `types` given to neon() is ignored; it must go with each query.
  constructor(url: string) { this.sql = neon(url); }
  prepare(query: string) { return new Statement(this, toPostgres(query)); }
  /** Runs all statements in a single transaction, like D1's batch(). */
  async batch(statements: Statement[]): Promise<RunResult[]> {
    const results = await this.sql.transaction(
      statements.map(s => this.sql.query(s.text, s.params, { types: typeParsers })),
      { fullResults: true, types: typeParsers },
    );
    return results.map(r => ({ results: r.rows, meta: { changes: r.rowCount ?? 0 } }));
  }
}

let cached: { url: string; client: Client } | undefined;
/** Returns a client for DATABASE_URL (pooled Neon URL), or null when it is not configured. */
export function database() {
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) return null;
  if (cached?.url !== url) cached = { url, client: new Client(url) };
  return cached.client;
}
