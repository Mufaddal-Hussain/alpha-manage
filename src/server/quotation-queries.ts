import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { businessProfile, customer, quotation, quotationLine, quotationRevision, termsTemplate } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { effectiveStatus, istDate, type DisplayStatus } from "@/lib/quotation/status";

const LIST_LIMIT = 200;

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface QuotationFilters {
  /** Matches the customer name or the bill-to name. */
  customer?: string;
  number?: string;
  status?: DisplayStatus;
  /** Inclusive quotation-date range, YYYY-MM-DD. */
  from?: string;
  to?: string;
}

/** Quotations for the list page (FR-021), newest first. Takes the database so tests can use the TEST database. */
export async function findQuotations(db: Database, filters: QuotationFilters, now: Date = new Date()) {
  const conditions: SQL[] = [];
  if (filters.customer?.trim()) {
    const pattern = likePattern(filters.customer.trim());
    conditions.push(or(ilike(customer.displayName, pattern), ilike(quotationRevision.billToName, pattern))!);
  }
  if (filters.number?.trim()) conditions.push(ilike(quotation.number, likePattern(filters.number.trim())));
  if (filters.from) conditions.push(gte(quotationRevision.quotationDate, filters.from));
  if (filters.to) conditions.push(lte(quotationRevision.quotationDate, filters.to));
  const today = istDate(now);
  if (filters.status === "expired") {
    conditions.push(and(eq(quotation.status, "sent"), sql`${quotationRevision.validUntil} < ${today}`)!);
  } else if (filters.status === "sent") {
    conditions.push(and(eq(quotation.status, "sent"), sql`${quotationRevision.validUntil} >= ${today}`)!);
  } else if (filters.status) {
    conditions.push(eq(quotation.status, filters.status));
  }

  const rows = await db
    .select({
      id: quotation.id,
      number: quotation.number,
      status: quotation.status,
      customerId: quotation.customerId,
      customerName: customer.displayName,
      revisionNo: quotationRevision.revisionNo,
      quotationDate: quotationRevision.quotationDate,
      validUntil: quotationRevision.validUntil,
      grandTotal: quotationRevision.grandTotal,
      layout: quotationRevision.layout,
      createdAt: quotation.createdAt,
    })
    .from(quotation)
    .innerJoin(customer, eq(quotation.customerId, customer.id))
    .innerJoin(quotationRevision, eq(quotation.currentRevisionId, quotationRevision.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(quotation.createdAt))
    .limit(LIST_LIMIT);
  return rows.map((r) => ({ ...r, displayStatus: effectiveStatus(r.status, r.validUntil, now) }));
}

/**
 * One quotation with the chosen revision (the current one unless `revisionNo` is given), that revision's lines and
 * the list of all revisions, newest first. Null when the id is unknown or the revision does not exist.
 */
export async function getQuotationDetail(db: Database, id: string, revisionNo?: number) {
  const [row] = await db
    .select({ quotation: quotation, customerName: customer.displayName })
    .from(quotation)
    .innerJoin(customer, eq(quotation.customerId, customer.id))
    .where(eq(quotation.id, id));
  if (!row) return null;
  const revisions = await db.select().from(quotationRevision).where(eq(quotationRevision.quotationId, id)).orderBy(desc(quotationRevision.revisionNo));
  const current =
    revisionNo === undefined ? revisions.find((r) => r.id === row.quotation.currentRevisionId) : revisions.find((r) => r.revisionNo === revisionNo);
  if (!current) return null;
  const lines = await db.select().from(quotationLine).where(eq(quotationLine.revisionId, current.id)).orderBy(asc(quotationLine.lineNo));
  return { quotation: row.quotation, customerName: row.customerName, current, revisions, lines };
}

// Wrappers for pages: authorise first, then read.

export async function listQuotations(filters: QuotationFilters) {
  await requireUser();
  return findQuotations(getDb(), filters);
}

export async function getQuotation(id: string, revisionNo?: number) {
  await requireUser();
  return getQuotationDetail(getDb(), id, revisionNo);
}

/** Settings the editor needs: validity default, business state (for the tax-mode hint) and terms templates. */
export async function getEditorSettings() {
  await requireUser();
  const db = getDb();
  const [profile] = await db.select().from(businessProfile).limit(1);
  const templates = await db.select().from(termsTemplate).orderBy(desc(termsTemplate.isDefault), asc(termsTemplate.name));
  const defaultTemplate = templates.find((t) => t.id === profile?.defaultTermsTemplateId) ?? templates.find((t) => t.isDefault) ?? null;
  return {
    businessStateCode: profile?.stateCode ?? null,
    validityDays: profile?.defaultQuotationValidityDays ?? 15,
    templates: templates.map((t) => ({ id: t.id, name: t.name, text: t.body.join("\n") })),
    defaultTermsText: defaultTemplate ? defaultTemplate.body.join("\n") : "",
    today: istDate(new Date()),
  };
}
