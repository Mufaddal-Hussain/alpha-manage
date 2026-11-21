import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { challanLine, customer, deliveryChallan, poLine, purchaseOrder, quotation, quotationRevision, user } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { getLineQuantities, statusFromQuantities } from "@/lib/challan/pending";
import { cancelRefusal } from "@/lib/challan/permissions";
import { parseCancelChallan, parseChallan, type ChallanInput, type ParsedChallan } from "@/lib/challan/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatDate, formatQuantity } from "@/lib/format";
import { normaliseGstin, validateGstin } from "@/lib/gstin";
import { dec } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { istDate } from "@/lib/quotation/status";

export type { ChallanInput } from "@/lib/challan/schema";

// Delivery challan domain operations (T073). Like order-core.ts: they take the database and the acting user's id, run in
// one transaction (the challan, its lines, the number, the PO status and the audit rows commit or roll back together)
// and have no session or framework dependency. src/server/challans.ts wraps them with requireUser() for the UI; the
// integration tests call them directly against the TEST database.
//
// The role of the actor is read from the user row inside the operation, not passed in by the caller, so a caller cannot
// claim to be the owner.

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function actorRole(tx: Tx, actorId: string): Promise<"owner" | "sales"> {
  const [row] = await tx.select({ role: user.role, active: user.active }).from(user).where(eq(user.id, actorId));
  if (!row || !row.active) throw new ForbiddenError("Your account cannot issue challans");
  return row.role;
}

/** Everything the PO's status needs: recomputed from the issued challans after a change, and audited when it moves. */
async function syncPurchaseOrderStatus(tx: Tx, actorId: string, orderId: string, current: typeof purchaseOrder.$inferSelect.status, note: string) {
  const quantities = await getLineQuantities(tx, orderId);
  const next = statusFromQuantities(quantities, current);
  if (next === current) return next;
  await tx.update(purchaseOrder).set({ status: next }).where(eq(purchaseOrder.id, orderId));
  await recordAudit(tx, { userId: actorId, entityType: "purchase_order", entityId: orderId, action: "status_change", fromStatus: current, toStatus: next, note });
  return next;
}

/**
 * Issues a challan against a PO.
 *
 * In one transaction: locks the PO and its lines (`FOR UPDATE`, so two challans for the same PO queue up and the second
 * sees what the first delivered), recomputes pending from the issued challans, refuses any line above pending (an owner
 * may override with a reason that is audited; sales cannot), takes the next number of the challan series, snapshots
 * consignee, buyer and the item details, and moves the PO to partially delivered / delivered.
 */
export async function createChallan(db: Database, actorId: string, input: ChallanInput, now: Date = new Date()): Promise<{ id: string; number: string }> {
  const parsed: ParsedChallan = parseChallan(input);

  return db.transaction(async (tx) => {
    const role = await actorRole(tx, actorId);

    // PO first, locked. Creating and cancelling challans for one PO take this lock first, so they never deadlock.
    const [order] = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.id, parsed.purchaseOrderId)).for("update");
    if (!order) throw new NotFoundError("That purchase order no longer exists");
    if (order.status === "cancelled") throw new ConflictError("This purchase order is cancelled, so no challan can be issued against it");
    const lines = await tx.select().from(poLine).where(eq(poLine.purchaseOrderId, order.id)).orderBy(poLine.lineNo).for("update");
    const byId = new Map(lines.map((l) => [l.id, l]));

    const today = istDate(now);
    if (parsed.challanDate > today) throw new ValidationError("The challan date cannot be in the future", { challanDate: "Cannot be in the future" });
    if (parsed.challanDate < order.poDate) throw new ValidationError("The challan date cannot be before the PO date", { challanDate: "Before the PO date" });

    // Lines: items of this PO, each at most once, whole boxes for box items.
    const seen = new Set<string>();
    const chosen = parsed.lines.map((line, i) => {
      const source = byId.get(line.poLineId);
      if (!source) throw new ValidationError(`Line ${i + 1}: that item is not on this PO`);
      if (seen.has(source.id)) throw new ValidationError(`Line ${i + 1}: ${source.description} is listed more than once`, { [`qty:${source.id}`]: "Listed twice" });
      seen.add(source.id);
      if (source.unit === "box" && !dec(line.quantity).isInteger()) {
        throw new ValidationError(`Line ${i + 1}: ${source.description} is sold in boxes; enter a whole number of boxes`, { [`qty:${source.id}`]: "Whole boxes only" });
      }
      return { source, quantity: dec(line.quantity) };
    });
    chosen.sort((a, b) => a.source.lineNo - b.source.lineNo);

    // Pending, recomputed under the lock.
    const quantities = new Map((await getLineQuantities(tx, order.id)).map((q) => [q.poLineId, q]));
    const over = chosen.filter(({ source, quantity }) => quantity.gt(quantities.get(source.id)!.pending));
    if (over.length > 0) {
      const detail = over
        .map(({ source, quantity }) => `${source.description}: ${formatQuantity(quantity.toFixed(3))} is more than the ${formatQuantity(quantities.get(source.id)!.pending)} still pending`)
        .join("; ");
      if (role !== "owner") {
        // Sales staff cannot deliver more than is pending, with or without a reason.
        throw new ConflictError(`${detail}. Only the owner can deliver more than what is pending.`);
      }
      if (!parsed.overrideReason) {
        throw new ValidationError(`${detail}. To deliver it anyway, give a reason for the override.`, {
          overrideReason: "A reason is needed to deliver more than is pending",
          ...Object.fromEntries(over.map(({ source }) => [`qty:${source.id}`, "More than pending"])),
        });
      }
    }

    // Parties: buyer from the approved revision's bill-to; consignee from its ship-to unless this dispatch says otherwise.
    const [head] = await tx
      .select({ revision: quotationRevision, quotationNumber: quotation.number, customerName: customer.displayName })
      .from(quotationRevision)
      .innerJoin(quotation, eq(quotation.id, quotationRevision.quotationId))
      .innerJoin(customer, eq(customer.id, order.customerId))
      .where(eq(quotationRevision.id, order.quotationRevisionId));
    if (!head) throw new ConflictError("The quotation of this PO could not be found");
    const rev = head.revision;
    const consignee = parsed.consignee
      ? {
          name: parsed.consignee.name,
          address: parsed.consignee.address,
          gstin: normaliseGstin(parsed.consignee.gstin),
          stateCode: parsed.consignee.stateCode,
        }
      : rev.shipToName || rev.shipToAddress
        ? { name: rev.shipToName || rev.billToName, address: rev.shipToAddress, gstin: null, stateCode: rev.shipToStateCode || rev.placeOfSupplyStateCode }
        : { name: rev.billToName, address: rev.billToAddress, gstin: rev.billToGstin, stateCode: rev.billToStateCode };
    const gstinProblem = validateGstin(consignee.gstin, consignee.stateCode);
    if (gstinProblem) throw new ValidationError(gstinProblem, { "consignee.gstin": gstinProblem });

    // Number last: the series row stays locked until commit, so keep everything that can fail before it.
    const issued = await nextNumber(tx, "challan", now);

    const [created] = await tx
      .insert(deliveryChallan)
      .values({
        number: issued.number,
        purchaseOrderId: order.id,
        customerId: order.customerId,
        challanDate: parsed.challanDate,
        consigneeName: consignee.name,
        consigneeGstin: consignee.gstin,
        consigneeAddress: consignee.address,
        consigneeStateCode: consignee.stateCode,
        buyerName: rev.billToName,
        buyerGstin: rev.billToGstin,
        buyerAddress: rev.billToAddress,
        buyerStateCode: rev.billToStateCode,
        taxMode: rev.taxMode,
        modeTermsOfPayment: parsed.modeTermsOfPayment,
        referenceNoDate: parsed.referenceNoDate ?? (head.quotationNumber ? `${head.quotationNumber} dt. ${formatDate(rev.quotationDate)}` : null),
        otherReferences: parsed.otherReferences,
        buyersOrderNoDate: `${order.customerPoNumber} dt. ${formatDate(order.poDate)}`,
        dispatchDocNo: parsed.dispatchDocNo,
        dispatchedThrough: parsed.dispatchedThrough,
        destination: parsed.destination,
        termsOfDelivery: parsed.termsOfDelivery,
        vehicleNo: parsed.vehicleNo,
        driverName: parsed.driverName,
        driverPhone: parsed.driverPhone,
        showPrices: parsed.showPrices,
        status: "issued",
        overrideReason: over.length > 0 ? parsed.overrideReason : null,
        createdBy: actorId,
        // The caller's clock, so "cancel on the day it was issued" judges the same instant the challan was issued at.
        createdAt: now,
      })
      .returning({ id: deliveryChallan.id });

    await tx.insert(challanLine).values(
      chosen.map(({ source, quantity }, i) => ({
        challanId: created.id,
        lineNo: i + 1,
        poLineId: source.id,
        description: source.description,
        hsnCode: source.hsnCode,
        unit: source.unit,
        quantity: quantity.toFixed(3),
        rate: source.rate,
        discountPercent: source.discountPercent,
        gstRate: source.gstRate,
      })),
    );

    const label = `${issued.number} against PO ${order.customerPoNumber}`;
    await recordAudit(tx, { userId: actorId, entityType: "delivery_challan", entityId: created.id, action: "create", toStatus: "issued", note: label });
    if (over.length > 0) {
      await recordAudit(tx, {
        userId: actorId,
        entityType: "delivery_challan",
        entityId: created.id,
        action: "override",
        note: `Delivered more than pending (${over.map(({ source, quantity }) => `${source.description}: ${quantity.toFixed(3)} against ${quantities.get(source.id)!.pending} pending`).join("; ")}). Reason: ${parsed.overrideReason}`,
      });
    }
    await syncPurchaseOrderStatus(tx, actorId, order.id, order.status, `Challan ${issued.number} issued`);
    return { id: created.id, number: issued.number };
  });
}

/**
 * Cancels an issued challan: it stays on file with its number, its quantities return to pending, and the PO status is
 * recomputed. The owner can cancel any challan; sales staff only their own, on the day it was issued
 * (contracts/ui-routes.md). A reason is required and audited.
 */
export async function cancelChallan(db: Database, actorId: string, input: { id: string; reason: string }, now: Date = new Date()): Promise<{ id: string; number: string; purchaseOrderId: string }> {
  const { id, reason } = parseCancelChallan(input);

  return db.transaction(async (tx) => {
    const role = await actorRole(tx, actorId);

    // Same lock order as createChallan: the PO first.
    const [found] = await tx.select({ orderId: deliveryChallan.purchaseOrderId }).from(deliveryChallan).where(eq(deliveryChallan.id, id));
    if (!found) throw new NotFoundError("That challan could not be found");
    const [order] = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.id, found.orderId)).for("update");
    const [challan] = await tx.select().from(deliveryChallan).where(eq(deliveryChallan.id, id)).for("update");
    if (!challan || !order) throw new NotFoundError("That challan could not be found");
    if (challan.status === "cancelled") throw new ConflictError(`Challan ${challan.number} is already cancelled`);
    const refusal = cancelRefusal(role, actorId, challan, now);
    if (refusal) throw new ForbiddenError(refusal);

    await tx.update(deliveryChallan).set({ status: "cancelled", cancelledAt: now, cancelReason: reason, cancelledBy: actorId }).where(and(eq(deliveryChallan.id, id), eq(deliveryChallan.status, "issued")));
    await recordAudit(tx, { userId: actorId, entityType: "delivery_challan", entityId: id, action: "status_change", fromStatus: "issued", toStatus: "cancelled", note: reason });
    await syncPurchaseOrderStatus(tx, actorId, order.id, order.status, `Challan ${challan.number} cancelled`);
    return { id, number: challan.number, purchaseOrderId: order.id };
  });
}
