import { defineConfig } from "drizzle-kit";

// Migrations need the DIRECT (non -pooler) Neon URL. Locally it comes from .env.
try { process.loadEnvFile(".env"); } catch { /* no .env: rely on the environment */ }
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  ...(url ? { dbCredentials: { url } } : {}),
});
