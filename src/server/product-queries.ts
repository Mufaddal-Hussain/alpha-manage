import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { chargeType, product } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";

const LIMIT = 100;

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Products matching a search on name, code, size or finish. Discontinued ones are left out unless asked for. */
export async function findProducts(db: Database, term: string, options: { includeDiscontinued?: boolean } = {}) {
  const q = term.trim();
  const conditions: SQL[] = [];
  if (!options.includeDiscontinued) conditions.push(eq(product.status, "active"));
  if (q !== "") {
    const pattern = likePattern(q);
    conditions.push(or(ilike(product.name, pattern), ilike(product.code, pattern), ilike(product.sizeLabel, pattern), ilike(product.finish, pattern))!);
  }
  return db
    .select()
    .from(product)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(q === "" ? desc(product.createdAt) : asc(product.name))
    .limit(LIMIT);
}

export async function searchProducts(term: string, options: { includeDiscontinued?: boolean } = {}) {
  await requireUser();
  return findProducts(getDb(), term, options);
}

export async function getProduct(id: string) {
  await requireUser();
  const [row] = await getDb().select().from(product).where(eq(product.id, id)).limit(1);
  return row ?? null;
}

export async function listChargeTypes() {
  await requireUser();
  return getDb().select().from(chargeType).where(eq(chargeType.active, true)).orderBy(asc(chargeType.name));
}
