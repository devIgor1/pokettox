// Test helper: an in-memory Postgres (PGlite) with the Drizzle migrations applied,
// plus a fake of Neon's HTTP SQL endpoint backed by it. Pointing the app's
// DATABASE_URL at FIXTURE_DATABASE_URL and routing its fetches to
// `neonHttpHandler` runs the real lib/pg.ts and @neondatabase/serverless code
// against a real Postgres, with no network and no Neon account involved.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';

export const FIXTURE_DATABASE_URL = 'postgresql://fixture:fixture@db.fixture.test/neondb?sslmode=require';
export const isFixtureDatabaseRequest = url => url.hostname.endsWith('.fixture.test') && url.pathname === '/sql';

export async function createTestDatabase() {
  const pg = await PGlite.create();
  for (const file of (await fs.readdir('drizzle')).filter(f => f.endsWith('.sql')).sort()) {
    await pg.exec((await fs.readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
  }
  return pg;
}

// Neon answers with every value as Postgres text; the driver parses it using
// dataTypeID. A parser table that returns the raw text for every type does that.
const rawText = new Proxy({}, { get: () => value => value });

async function run(db, { query, params = [] }) {
  const result = await db.query(query, params, { rowMode: 'array', parsers: rawText });
  return {
    command: query.trim().split(/\s+/)[0].toUpperCase(),
    fields: result.fields.map(f => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rows: result.rows.map(row => row.map(v => (v === null || v === undefined ? null : String(v)))),
    rowCount: result.affectedRows || result.rows.length,
  };
}

/** Handles one request from the Neon HTTP driver. Batches run in a transaction. */
export async function neonHttpHandler(pg, request) {
  const body = await request.json();
  try {
    if (Array.isArray(body.queries)) {
      const results = await pg.transaction(async tx => {
        const out = [];
        for (const q of body.queries) out.push(await run(tx, q));
        return out;
      });
      return Response.json({ results });
    }
    return Response.json(await run(pg, body));
  } catch (error) {
    return Response.json({ message: error.message, code: error.code }, { status: 400 });
  }
}

/** Convenience for assertions: rows as objects with plain JS values. */
export async function rows(pg, query, params = []) {
  return (await pg.query(query, params)).rows;
}
