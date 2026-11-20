import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { brand, chargeType, priceGroup, priceList, product } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";

const LIMIT = 100;

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Products matching a search on name, code, size or finish. Discontinued ones are left out unless asked for. */
export async function findProducts(db: Database, term: string, options: { includeDiscontinued?: boolean; needsReviewOnly?: boolean } = {}) {
  const q = term.trim();
  const conditions: SQL[] = [];
  if (!options.includeDiscontinued) conditions.push(eq(product.status, "active"));
  if (options.needsReviewOnly) conditions.push(eq(product.costReviewNeeded, true));
  // Every word must match somewhere (name, code, size, finish or brand), so "colortile imperia silver" finds it.
  for (const word of q.split(/\s+/).filter(Boolean).slice(0, 6)) {
    const pattern = likePattern(word);
    conditions.push(or(ilike(product.name, pattern), ilike(product.code, pattern), ilike(product.sizeLabel, pattern), ilike(product.finish, pattern), ilike(brand.name, pattern))!);
  }
  const rows = await db
    .select({ product, brandName: brand.name })
    .from(product)
    .leftJoin(brand, eq(brand.id, product.brandId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(q === "" && !options.needsReviewOnly ? desc(product.createdAt) : asc(product.name))
    .limit(LIMIT);
  return rows.map((r) => ({ ...r.product, brandName: r.brandName }));
}

export async function searchProducts(term: string, options: { includeDiscontinued?: boolean; needsReviewOnly?: boolean } = {}) {
  await requireUser();
  return findProducts(getDb(), term, options);
}

export async function getProduct(id: string) {
  await requireUser();
  const [row] = await getDb()
    .select({ product, brandName: brand.name, priceListId: priceList.id, priceListLabel: priceList.label, priceListEffectiveFrom: priceList.effectiveFrom })
    .from(product)
    .leftJoin(brand, eq(brand.id, product.brandId))
    .leftJoin(priceGroup, eq(priceGroup.id, product.priceGroupId))
    .leftJoin(priceList, eq(priceList.id, priceGroup.priceListId))
    .where(eq(product.id, id))
    .limit(1);
  if (!row) return null;
  const { product: p, ...source } = row;
  return { ...p, ...source };
}

/** How many active products have a cost change nobody has reviewed yet (shown on the products page). */
export async function countProductsNeedingReview(): Promise<number> {
  await requireUser();
  const rows = await getDb().select({ id: product.id }).from(product).where(and(eq(product.costReviewNeeded, true), eq(product.status, "active")));
  return rows.length;
}

export async function listChargeTypes() {
  await requireUser();
  return getDb().select().from(chargeType).where(eq(chargeType.active, true)).orderBy(asc(chargeType.name));
}
