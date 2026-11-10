import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Drizzle query builder over Neon, for new code. Existing code uses raw SQL via lib/pg.ts.
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (Neon Postgres) is not configured.");
  return drizzle(neon(url), { schema });
}
