import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Same .env.local / .env loading as Next.js, so db:* scripts see DATABASE_URL.
loadEnvConfig(process.cwd());

// Migrations prefer a direct (unpooled) connection when the host provides one (Neon sets DATABASE_URL_UNPOOLED).
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

// `generate` only diffs the schema files and needs no database; every other command does.
if (!url && !process.argv.includes("generate")) {
  throw new Error("DATABASE_URL is not set (see .env.example)");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
  out: "./src/db/migrations",
  dbCredentials: { url: url ?? "" },
});
