import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

// Plain `pg` over TCP: works with a local Postgres and with Neon (use its pooled connection string).
export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __alphaPool?: Pool };

/** Lazily created database client for server actions and route handlers (Node runtime). */
export function getDb(): Database {
  globalForDb.__alphaPool ??= new Pool({ connectionString: getEnv().DATABASE_URL, max: 5 });
  return drizzle(globalForDb.__alphaPool, { schema });
}
