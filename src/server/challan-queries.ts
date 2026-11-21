import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { challanLine, customer, deliveryChallan, poLine, purchaseOrder, quotation, quotationRevision, user, type ChallanStatus } from "@/db/schema";
import { getLineQuantities, type LineQuantity } from "@/lib/challan/pending";
import { requireUser } from "@/lib/auth/session";

const LIST_LIMIT = 200;

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface ChallanFilters {
  /** Matches the customer name. */
  customer?: string;
  /** Matches the challan number (part of it, any case). */
  number?: string;
  /** Matches the customer's PO number. */
  poNumber?: string;
  status?: ChallanStatus;
  /** Inclusive challan-date range, YYYY-MM-DD. */
  from?: string;
  to?: string;
}

/** Challans for the list page (SC-008: find by customer, number or date), newest first. */
export async function findChallans(db: Database, filters: ChallanFilters) {
  const conditions: SQL[] = [];
  if (filters.customer?.trim()) conditions.push(ilike(customer.displayName, likePattern(filters.customer.trim())));
  if (filters.number?.trim()) conditions.push(ilike(deliveryChallan.number, likePattern(filters.number.trim())));
  if (filters.poNumber?.trim()) conditions.push(ilike(purchaseOrder.customerPoNumber, likePattern(filters.poNumber.trim())));
  if (filters.status) conditions.push(eq(deliveryChallan.status, filters.status));
  if (filters.from) conditions.push(gte(deliveryChallan.challanDate, filters.from));
  if (filters.to) conditions.push(lte(deliveryChallan.challanDate, filters.to));

  return db
    .select({
      id: deliveryChallan.id,
      number: deliveryChallan.number,
      challanDate: deliveryChallan.challanDate,
      status: deliveryChallan.status,
      vehicleNo: deliveryChallan.vehicleNo,
      customerId: deliveryChallan.customerId,
      customerName: customer.displayName,
      purchaseOrderId: deliveryChallan.purchaseOrderId,
      customerPoNumber: purchaseOrder.customerPoNumber,
      createdAt: deliveryChallan.createdAt,
    })
    .from(deliveryChallan)
    .innerJoin(customer, eq(deliveryChallan.customerId, customer.id))
    .innerJoin(purchaseOrder, eq(deliveryChallan.purchaseOrderId, purchaseOrder.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(deliveryChallan.challanDate), desc(deliveryChallan.createdAt))
    .limit(LIST_LIMIT);
}

/** The challans of one PO, oldest first, with what each carried (shown on the PO page). */
export async function listChallansForOrder(db: Database, purchaseOrderId: string) {
  return db
    .select({
      id: deliveryChallan.id,
      number: deliveryChallan.number,
      challanDate: deliveryChallan.challanDate,
      status: deliveryChallan.status,
      vehicleNo: deliveryChallan.vehicleNo,
      totalQuantity: sql<string>`coalesce((select sum(${challanLine.quantity}) from ${challanLine} where ${challanLine.challanId} = ${deliveryChallan.id}), 0)::text`,
    })
    .from(deliveryChallan)
    .where(eq(deliveryChallan.purchaseOrderId, purchaseOrderId))
    .orderBy(asc(deliveryChallan.createdAt));
}

/** One challan with its lines, the PO it belongs to and who issued / cancelled it. Null when unknown. */
export async function getChallanDetail(db: Database, id: string) {
  const [head] = await db
    .select({
      challan: deliveryChallan,
      customerName: customer.displayName,
      customerPoNumber: purchaseOrder.customerPoNumber,
      quotationId: purchaseOrder.quotationId,
      quotationNumber: quotation.number,
    })
    .from(deliveryChallan)
    .innerJoin(customer, eq(deliveryChallan.customerId, customer.id))
    .innerJoin(purchaseOrder, eq(deliveryChallan.purchaseOrderId, purchaseOrder.id))
    .innerJoin(quotation, eq(purchaseOrder.quotationId, quotation.id))
    .where(eq(deliveryChallan.id, id));
  if (!head) return null;
  const lines = await db.select().from(challanLine).where(eq(challanLine.challanId, id)).orderBy(asc(challanLine.lineNo));
  const userIds = [head.challan.createdBy, head.challan.cancelledBy].filter((v): v is string => v !== null);
  const users = userIds.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)) : [];
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;
  return { ...head, lines, createdByName: nameOf(head.challan.createdBy), cancelledByName: nameOf(head.challan.cancelledBy) };
}

/** A PO line with its ordered / delivered / pending figures. */
export interface DeliveryLine extends LineQuantity {
  description: string;
  hsnCode: string;
  unit: "box" | "sqft" | "piece";
  rate: string;
  discountPercent: string;
}

/** Per-line delivery progress of a PO, for the PO page and the challan form. */
export async function getDeliveryProgress(db: Database, purchaseOrderId: string): Promise<DeliveryLine[]> {
  const quantities = await getLineQuantities(db, purchaseOrderId);
  const lines = await db.select().from(poLine).where(eq(poLine.purchaseOrderId, purchaseOrderId)).orderBy(asc(poLine.lineNo));
  const byId = new Map(quantities.map((q) => [q.poLineId, q]));
  return lines.map((l) => ({
    ...byId.get(l.id)!,
    description: l.description,
    hsnCode: l.hsnCode,
    unit: l.unit,
    rate: l.rate,
    discountPercent: l.discountPercent,
  }));
}

/** What the "New challan" form needs for a PO: header defaults taken from the PO and its quotation, and the lines with pending quantities. Null when unknown. */
export async function getChallanFormData(db: Database, purchaseOrderId: string) {
  const [row] = await db
    .select({ order: purchaseOrder, customerName: customer.displayName, quotationNumber: quotation.number, revision: quotationRevision })
    .from(purchaseOrder)
    .innerJoin(customer, eq(purchaseOrder.customerId, customer.id))
    .innerJoin(quotation, eq(purchaseOrder.quotationId, quotation.id))
    .innerJoin(quotationRevision, eq(purchaseOrder.quotationRevisionId, quotationRevision.id))
    .where(eq(purchaseOrder.id, purchaseOrderId));
  if (!row) return null;
  return { ...row, lines: await getDeliveryProgress(db, purchaseOrderId), challans: await listChallansForOrder(db, purchaseOrderId) };
}

/** POs that still have something to deliver (the picker on /challans/new): open or partially delivered, newest first. */
export async function listOrdersToDeliver(db: Database) {
  return db
    .select({
      id: purchaseOrder.id,
      customerPoNumber: purchaseOrder.customerPoNumber,
      poDate: purchaseOrder.poDate,
      status: purchaseOrder.status,
      customerName: customer.displayName,
    })
    .from(purchaseOrder)
    .innerJoin(customer, eq(purchaseOrder.customerId, customer.id))
    .where(inArray(purchaseOrder.status, ["open", "partially_delivered"]))
    .orderBy(desc(purchaseOrder.poDate), desc(purchaseOrder.createdAt))
    .limit(50);
}

// Wrappers for pages: authorise first, then read.

export async function listChallans(filters: ChallanFilters) {
  await requireUser();
  return findChallans(getDb(), filters);
}

export async function getChallan(id: string) {
  await requireUser();
  return getChallanDetail(getDb(), id);
}

export async function getChallanForm(purchaseOrderId: string) {
  await requireUser();
  return getChallanFormData(getDb(), purchaseOrderId);
}

export async function getOrderDelivery(purchaseOrderId: string) {
  await requireUser();
  const db = getDb();
  return { lines: await getDeliveryProgress(db, purchaseOrderId), challans: await listChallansForOrder(db, purchaseOrderId) };
}

export async function getOrdersToDeliver() {
  await requireUser();
  return listOrdersToDeliver(getDb());
}
