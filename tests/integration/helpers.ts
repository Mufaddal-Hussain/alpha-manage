import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/db/schema";

/** True when integration tests have a database to run against. */
export function hasTestDb(): boolean {
  return Boolean(process.env.TEST_DATABASE_URL);
}

let pool: Pool | undefined;
let ready: Promise<ReturnType<typeof createDb>> | undefined;

function createDb(p: Pool) {
  return drizzle(p, { schema });
}

/**
 * Database client for the TEST database only. Applies migrations once per run
 * (idempotent) and refuses to run if TEST_DATABASE_URL points at the main database.
 */
export function getTestDb(): Promise<ReturnType<typeof createDb>> {
  ready ??= (async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is not set");
    const main = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
    if (main && stripCredentials(main) === stripCredentials(url)) {
      throw new Error("TEST_DATABASE_URL must not be the same database as DATABASE_URL; refusing to run tests");
    }
    pool = new Pool({ connectionString: url, max: 20 });
    const db = createDb(pool);
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
    return db;
  })();
  return ready;
}

export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  ready = undefined;
}

/** host + database name, ignoring user, password and query string (pooled and direct hosts differ only by the host label). */
function stripCredentials(connectionString: string): string {
  const u = new URL(connectionString);
  return `${u.hostname.replace("-pooler", "")}${u.pathname}`;
}
