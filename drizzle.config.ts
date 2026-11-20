import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Same .env.local / .env loading as Next.js, so db:* scripts see DATABASE_URL.
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (see .env.example)");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema", // tables are added in the foundation phase
  out: "./src/db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL },
});
