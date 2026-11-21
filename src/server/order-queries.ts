import { and, asc, desc, eq, gte, ilike, lte, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import {
  customer,
  file,
  poFile,
  poLine,
  purchaseOrder,
  quotation,
  quotationLine,
  quotationRevision,
  type PurchaseOrderStatus,
} from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { orderValue } from "@/lib/order/value";
import { effectiveStatus } from "@/lib/quotation/status";

const LIST_LIMIT = 200;

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface PurchaseOrderFilters {
  /** Matches the customer name. */
  customer?: string;
  /** Matches the customer's PO number (part of it, any case). */
  poNumber?: string;
  quotationNumber?: string;
  status?: PurchaseOrderStatus;
  /** Inclusive PO-date range, YYYY-MM-DD. */
  from?: string;
  to?: string;
}

/** POs for the list page (SC-008: find by customer, number or date), newest PO date first. */
export async function findPurchaseOrders(db: Database, filters: PurchaseOrderFilters) {
  const conditions: SQL[] = [];
  if (filters.customer?.trim()) conditions.push(ilike(customer.displayName, likePattern(filters.customer.trim())));
  if (filters.poNumber?.trim()) conditions.push(ilike(purchaseOrder.customerPoNumber, likePattern(filters.poNumber.trim())));
  if (filters.quotationNumber?.trim()) conditions.push(ilike(quotation.number, likePattern(filters.quotationNumber.trim())));
  if (filters.status) conditions.push(eq(purchaseOrder.status, filters.status));
  if (filters.from) conditions.push(gte(purchaseOrder.poDate, filters.from));
  if (filters.to) conditions.push(lte(purchaseOrder.poDate, filters.to));

  return db
    .select({
      id: purchaseOrder.id,
      customerPoNumber: purchaseOrder.customerPoNumber,
      poDate: purchaseOrder.poDate,
      status: purchaseOrder.status,
      advanceReceived: purchaseOrder.advanceReceived,
      customerId: purchaseOrder.customerId,
      customerName: customer.displayName,
      quotationId: purchaseOrder.quotationId,
      quotationNumber: quotation.number,
      createdAt: purchaseOrder.createdAt,
    })
    .from(purchaseOrder)
    .innerJoin(customer, eq(purchaseOrder.customerId, customer.id))
    .innerJoin(quotation, eq(purchaseOrder.quotationId, quotation.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(purchaseOrder.poDate), desc(purchaseOrder.createdAt))
    .limit(LIST_LIMIT);
}

/** The POs recorded against one quotation, oldest first (shown on the quotation page). */
export async function listPurchaseOrdersForQuotation(db: Database, quotationId: string) {
  return db
    .select({
      id: purchaseOrder.id,
      customerPoNumber: purchaseOrder.customerPoNumber,
      poDate: purchaseOrder.poDate,
      status: purchaseOrder.status,
    })
    .from(purchaseOrder)
    .where(eq(purchaseOrder.quotationId, quotationId))
    .orderBy(asc(purchaseOrder.createdAt));
}

/**
 * One PO with everything its page shows: header, customer and quotation, ordered lines (with the quoted quantity beside
 * each), the quotation's items that were not ordered, attachments, and the value ordered versus quoted. Null when unknown.
 */
export async function getPurchaseOrderDetail(db: Database, id: string) {
  const [head] = await db
    .select({
      order: purchaseOrder,
      customerName: customer.displayName,
      quotationNumber: quotation.number,
      revisionNo: quotationRevision.revisionNo,
      taxMode: quotationRevision.taxMode,
    })
    .from(purchaseOrder)
    .innerJoin(customer, eq(purchaseOrder.customerId, customer.id))
    .innerJoin(quotation, eq(purchaseOrder.quotationId, quotation.id))
    .innerJoin(quotationRevision, eq(purchaseOrder.quotationRevisionId, quotationRevision.id))
    .where(eq(purchaseOrder.id, id));
  if (!head) return null;

  const lines = await db.select().from(poLine).where(eq(poLine.purchaseOrderId, id)).orderBy(asc(poLine.lineNo));
  const quoted = await db
    .select()
    .from(quotationLine)
    .where(and(eq(quotationLine.revisionId, head.order.quotationRevisionId), eq(quotationLine.kind, "product")))
    .orderBy(asc(quotationLine.lineNo));
  const orderedLineIds = new Set(lines.map((l) => l.quotationLineId).filter((v): v is string => v !== null));
  const files = await db
    .select({ id: file.id, originalName: file.originalName, mimeType: file.mimeType, size: file.size })
    .from(poFile)
    .innerJoin(file, eq(poFile.fileId, file.id))
    .where(eq(poFile.purchaseOrderId, id))
    .orderBy(asc(file.originalName));

  return {
    order: head.order,
    customerName: head.customerName,
    quotationNumber: head.quotationNumber,
    revisionNo: head.revisionNo,
    lines,
    notOrdered: quoted.filter((l) => !orderedLineIds.has(l.id)),
    files,
    value: orderValue(
      lines.map((l) => ({ quantity: l.quantityOrdered, rate: l.rate, discountPercent: l.discountPercent, gstRate: l.gstRate })),
      head.taxMode,
    ),
    quotedValue: orderValue(
      quoted.map((l) => ({ quantity: l.quantity, rate: l.rate, discountPercent: l.discountPercent, gstRate: l.gstRate })),
      head.taxMode,
    ),
  };
}

/**
 * What the "Record PO" form needs for a quotation: whether a PO may be recorded now, who the customer is, the items
 * that can be ordered (product lines of the current revision) and the POs already recorded. Null when unknown.
 */
export async function getPoFormData(db: Database, quotationId: string, now: Date = new Date()) {
  const [row] = await db
    .select({ quotation: quotation, customerName: customer.displayName, revision: quotationRevision })
    .from(quotation)
    .innerJoin(customer, eq(quotation.customerId, customer.id))
    .innerJoin(quotationRevision, eq(quotation.currentRevisionId, quotationRevision.id))
    .where(eq(quotation.id, quotationId));
  if (!row) return null;
  const lines = await db
    .select()
    .from(quotationLine)
    .where(and(eq(quotationLine.revisionId, row.revision.id), eq(quotationLine.kind, "product")))
    .orderBy(asc(quotationLine.lineNo));
  return {
    quotation: row.quotation,
    customerName: row.customerName,
    revision: row.revision,
    view: effectiveStatus(row.quotation.status, row.revision.validUntil, now),
    lines,
    orders: await listPurchaseOrdersForQuotation(db, quotationId),
  };
}

/** Approved quotations, newest approval first, with how many POs each already has (the picker on /orders/new). */
export async function listApprovedQuotations(db: Database) {
  return db
    .select({
      id: quotation.id,
      number: quotation.number,
      customerName: customer.displayName,
      approvedAt: quotation.approvedAt,
      grandTotal: quotationRevision.grandTotal,
      orderCount: sql<number>`(select count(*)::int from ${purchaseOrder} where ${purchaseOrder.quotationId} = ${quotation.id} and ${purchaseOrder.status} <> 'cancelled')`,
    })
    .from(quotation)
    .innerJoin(customer, eq(quotation.customerId, customer.id))
    .innerJoin(quotationRevision, eq(quotation.currentRevisionId, quotationRevision.id))
    .where(eq(quotation.status, "approved"))
    .orderBy(desc(quotation.approvedAt))
    .limit(50);
}

// Wrappers for pages: authorise first, then read.

export async function listPurchaseOrders(filters: PurchaseOrderFilters) {
  await requireUser();
  return findPurchaseOrders(getDb(), filters);
}

export async function getPurchaseOrder(id: string) {
  await requireUser();
  return getPurchaseOrderDetail(getDb(), id);
}

export async function getPurchaseOrderForm(quotationId: string) {
  await requireUser();
  return getPoFormData(getDb(), quotationId);
}

export async function getApprovedQuotations() {
  await requireUser();
  return listApprovedQuotations(getDb());
}

export async function getQuotationPurchaseOrders(quotationId: string) {
  await requireUser();
  return listPurchaseOrdersForQuotation(getDb(), quotationId);
}
