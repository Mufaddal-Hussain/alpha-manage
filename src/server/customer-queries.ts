import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { customer, customerAddress, customerContact } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";

const SEARCH_LIMIT = 100;

/** Escapes LIKE wildcards so a typed `%` or `_` is searched literally. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Customers matching a search term on name, legal name, GSTIN or phone (phone digits are compared
 * without spaces or punctuation). An empty term lists the most recently added. Takes the database
 * so integration tests can run it against the test database; pages call `searchCustomers`.
 */
export async function findCustomers(db: Database, term: string, options: { includeInactive?: boolean } = {}) {
  const q = term.trim();
  const conditions: SQL[] = [];
  if (!options.includeInactive) conditions.push(eq(customer.active, true));
  if (q !== "") {
    const pattern = likePattern(q);
    const matches: (SQL | undefined)[] = [
      ilike(customer.displayName, pattern),
      ilike(customer.legalName, pattern),
      ilike(customer.gstin, pattern),
      ilike(customer.phone, pattern),
    ];
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) matches.push(sql`regexp_replace(${customer.phone}, '\\D', '', 'g') LIKE ${`%${digits}%`}`);
    conditions.push(or(...matches)!);
  }
  return db
    .select()
    .from(customer)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(q === "" ? desc(customer.createdAt) : asc(customer.displayName))
    .limit(SEARCH_LIMIT);
}

export async function searchCustomers(term: string, options: { includeInactive?: boolean } = {}) {
  await requireUser();
  return findCustomers(getDb(), term, options);
}

/** One customer with its shipping addresses and contacts, or null when the id is unknown. */
export async function getCustomerDetail(id: string) {
  await requireUser();
  const db = getDb();
  const [row] = await db.select().from(customer).where(eq(customer.id, id)).limit(1);
  if (!row) return null;
  const [addresses, contacts] = await Promise.all([
    db
      .select()
      .from(customerAddress)
      .where(eq(customerAddress.customerId, id))
      .orderBy(desc(customerAddress.isDefaultShipping), asc(customerAddress.label)),
    db.select().from(customerContact).where(eq(customerContact.customerId, id)).orderBy(asc(customerContact.name)),
  ]);
  return { customer: row, addresses, contacts };
}
