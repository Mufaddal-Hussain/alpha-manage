import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { customer, purchaseOrder, quotation, quotationRevision } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { addDays, istDate } from "@/lib/quotation/status";

/** A sent quotation counts as "expiring soon" when its last valid day is within this many days (today included). */
export const EXPIRING_SOON_DAYS = 7;

/** Rows shown per dashboard list; the counts above each list are always the full numbers. */
export const DASHBOARD_LIST_LIMIT = 8;

export interface DashboardOptions {
  now?: Date;
  /** How many rows each list returns. Tests pass a large number so leftover rows of other tests cannot crowd theirs out. */
  limit?: number;
}

/**
 * What the dashboard shows (contracts/ui-routes.md `/`):
 *  - open quotations: issued and waiting for the customer (`sent`, still valid) plus drafts in progress;
 *  - expiring soon: sent quotations whose valid-until date falls in the next EXPIRING_SOON_DAYS days;
 *  - POs with pending deliveries: open or partially delivered POs, with how many lines still have goods to deliver.
 * Pure reads; the caller has already authorised the request.
 */
export async function getDashboardData(db: Database, options: DashboardOptions = {}) {
  const now = options.now ?? new Date();
  const limit = options.limit ?? DASHBOARD_LIST_LIMIT;
  const today = istDate(now);
  const soonEnd = addDays(today, EXPIRING_SOON_DAYS);

  const quotationRows = () =>
    db
      .select({
        id: quotation.id,
        number: quotation.number,
        status: quotation.status,
        customerName: customer.displayName,
        validUntil: quotationRevision.validUntil,
        grandTotal: quotationRevision.grandTotal,
        revisionNo: quotationRevision.revisionNo,
      })
      .from(quotation)
      .innerJoin(customer, eq(quotation.customerId, customer.id))
      .innerJoin(quotationRevision, eq(quotation.currentRevisionId, quotationRevision.id));

  const sentAndValid = and(eq(quotation.status, "sent"), gte(quotationRevision.validUntil, today));
  const expiringSoon = and(eq(quotation.status, "sent"), gte(quotationRevision.validUntil, today), lte(quotationRevision.validUntil, soonEnd));

  const [awaiting, drafts, expiring, orders] = await Promise.all([
    quotationRows().where(sentAndValid).orderBy(asc(quotationRevision.validUntil), asc(quotation.number)).limit(limit),
    db.select({ n: sql<number>`count(*)::int` }).from(quotation).where(eq(quotation.status, "draft")),
    quotationRows().where(expiringSoon).orderBy(asc(quotationRevision.validUntil), asc(quotation.number)).limit(limit),
    db
      .select({
        id: purchaseOrder.id,
        customerPoNumber: purchaseOrder.customerPoNumber,
        poDate: purchaseOrder.poDate,
        status: purchaseOrder.status,
        customerName: customer.displayName,
        quotationNumber: quotation.number,
        lineCount: sql<number>`(select count(*)::int from po_line pl where pl.purchase_order_id = ${purchaseOrder.id})`,
        // A line is pending while the issued challans have not covered what was ordered (cancelled challans do not count).
        pendingLines: sql<number>`(
          select count(*)::int from po_line pl
          where pl.purchase_order_id = ${purchaseOrder.id}
            and pl.quantity_ordered > coalesce((
              select sum(cl.quantity) from challan_line cl
              join delivery_challan dc on dc.id = cl.challan_id
              where cl.po_line_id = pl.id and dc.status = 'issued'
            ), 0)
        )`,
      })
      .from(purchaseOrder)
      .innerJoin(customer, eq(purchaseOrder.customerId, customer.id))
      .innerJoin(quotation, eq(purchaseOrder.quotationId, quotation.id))
      .where(inArray(purchaseOrder.status, ["open", "partially_delivered"]))
      .orderBy(asc(purchaseOrder.poDate), asc(purchaseOrder.createdAt)),
  ]);

  // Counts come from separate cheap queries so a list limit never changes them.
  const [[awaitingCount], [expiringCount]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(quotation)
      .innerJoin(quotationRevision, eq(quotation.currentRevisionId, quotationRevision.id))
      .where(sentAndValid),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(quotation)
      .innerJoin(quotationRevision, eq(quotation.currentRevisionId, quotationRevision.id))
      .where(expiringSoon),
  ]);

  // A PO whose every line is covered but whose status was not yet moved is not "pending"; the status is the source of
  // truth for the list (the challan transaction keeps it in step), pendingLines is shown as extra detail.
  return {
    today,
    soonEnd,
    openQuotations: { awaitingDecision: awaitingCount.n, drafts: drafts[0].n, rows: awaiting },
    expiringSoon: { count: expiringCount.n, rows: expiring },
    pendingDeliveries: { count: orders.length, rows: orders.slice(0, limit) },
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

/** Page wrapper: authorise first, then read. */
export async function getDashboard() {
  await requireUser();
  return getDashboardData(getDb());
}
