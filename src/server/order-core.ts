import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { customer, file, poFile, poLine, purchaseOrder, quotation, quotationLine, quotationRevision } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { dec } from "@/lib/money";
import { parsePurchaseOrder, type ParsedPurchaseOrder, type PurchaseOrderInput } from "@/lib/order/schema";
import { canRecordPurchaseOrder, effectiveStatus, purchaseOrderRefusal } from "@/lib/quotation/status";

export type { PurchaseOrderInput } from "@/lib/order/schema";

// Purchase order domain operations (T067). Like quotation-core.ts: they take the database and the acting user's id,
// run in one transaction (the PO, its lines, its file links and the audit rows commit or roll back together) and have no
// session or framework dependency. src/server/orders.ts wraps them with requireUser() and the file upload for the UI;
// the integration tests call them directly against the TEST database.

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The customer already has a PO with this number. Recording it anyway needs `confirmDuplicate: true`; the override is
 * then written to the audit log (FR-024).
 */
export class DuplicatePurchaseOrderError extends DomainError {
  constructor(
    readonly existingId: string,
    readonly customerPoNumber: string,
  ) {
    super(`This customer already has a PO numbered ${customerPoNumber}. Confirm if this is a different order with the same number.`, "duplicate_po");
  }
}

/** Case and surrounding spaces do not make a different PO number. */
const samePoNumber = (column: typeof purchaseOrder.customerPoNumber, value: string) => sql`lower(btrim(${column})) = lower(btrim(${value}))`;

async function assertAttachments(tx: Tx, fileIds: string[]) {
  if (fileIds.length === 0) return;
  const unique = [...new Set(fileIds)];
  const found = await tx.select({ id: file.id }).from(file).where(inArray(file.id, unique));
  if (found.length !== unique.length) throw new ValidationError("An attachment could not be found; attach the file again");
}

/**
 * Records the customer's PO against an approved quotation: snapshots the ordered items from the approved revision,
 * keeps the quoted quantity for the difference display, links the attachments and audits the creation (and a
 * confirmed duplicate number). The quotation itself is not touched.
 */
export async function recordPurchaseOrder(db: Database, actorId: string, input: PurchaseOrderInput, now: Date = new Date()): Promise<{ id: string }> {
  const parsed: ParsedPurchaseOrder = parsePurchaseOrder(input);

  return db.transaction(async (tx) => {
    // Quotation first, locked: a concurrent reject/revise/PO on it queues behind this transaction.
    const [row] = await tx.select().from(quotation).where(eq(quotation.id, parsed.quotationId)).for("update");
    if (!row) throw new NotFoundError("That quotation no longer exists");
    if (!row.currentRevisionId) throw new ConflictError("This quotation has no revision");
    const [revision] = await tx.select().from(quotationRevision).where(eq(quotationRevision.id, row.currentRevisionId));
    if (!revision) throw new ConflictError("This quotation has no revision");

    const view = effectiveStatus(row.status, revision.validUntil, now);
    if (!canRecordPurchaseOrder(view)) throw new ConflictError(purchaseOrderRefusal(view));

    // Ordered lines must be product lines of the approved revision, each at most once.
    const quoted = await tx.select().from(quotationLine).where(eq(quotationLine.revisionId, revision.id)).orderBy(quotationLine.lineNo);
    const byId = new Map(quoted.map((l) => [l.id, l]));
    const seen = new Set<string>();
    const chosen = parsed.lines.map((line, i) => {
      const source = byId.get(line.quotationLineId);
      if (!source) throw new ValidationError(`Line ${i + 1}: that item is not on this quotation`);
      if (source.kind !== "product") throw new ValidationError(`Line ${i + 1}: ${source.description} is a charge, not an item to deliver`);
      if (seen.has(source.id)) throw new ValidationError(`Line ${i + 1}: ${source.description} is listed more than once`);
      seen.add(source.id);
      if (source.unit === "box" && !dec(line.quantity).isInteger()) {
        throw new ValidationError(`Line ${i + 1}: ${source.description} is sold in boxes; enter a whole number of boxes`);
      }
      return { source, quantity: line.quantity };
    });
    // Keep the quotation's own order, whatever order the form sent.
    chosen.sort((a, b) => a.source.lineNo - b.source.lineNo);

    await assertAttachments(tx, parsed.fileIds);

    // Duplicate check under a lock on the customer, so two simultaneous submissions of one number cannot both pass.
    await tx.select({ id: customer.id }).from(customer).where(eq(customer.id, row.customerId)).for("update");
    const [existing] = await tx
      .select({ id: purchaseOrder.id })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.customerId, row.customerId), ne(purchaseOrder.status, "cancelled"), samePoNumber(purchaseOrder.customerPoNumber, parsed.customerPoNumber)))
      .limit(1);
    if (existing && !parsed.confirmDuplicate) throw new DuplicatePurchaseOrderError(existing.id, parsed.customerPoNumber);

    const [created] = await tx
      .insert(purchaseOrder)
      .values({
        quotationId: row.id,
        quotationRevisionId: revision.id,
        customerId: row.customerId,
        customerPoNumber: parsed.customerPoNumber,
        poDate: parsed.poDate,
        advanceReceived: dec(parsed.advanceReceived).toFixed(2),
        notes: parsed.notes,
        status: "open",
        createdBy: actorId,
      })
      .returning({ id: purchaseOrder.id });

    await tx.insert(poLine).values(
      chosen.map(({ source, quantity }, i) => ({
        purchaseOrderId: created.id,
        lineNo: i + 1,
        quotationLineId: source.id,
        description: source.description,
        hsnCode: source.hsnCode,
        unit: source.unit,
        quantityOrdered: dec(quantity).toFixed(3),
        quantityQuoted: source.quantity,
        rate: source.rate,
        discountPercent: source.discountPercent,
        gstRate: source.gstRate,
      })),
    );
    if (parsed.fileIds.length) {
      await tx.insert(poFile).values([...new Set(parsed.fileIds)].map((fileId) => ({ purchaseOrderId: created.id, fileId })));
    }

    const label = `${parsed.customerPoNumber} against ${row.number}`;
    await recordAudit(tx, { userId: actorId, entityType: "purchase_order", entityId: created.id, action: "create", toStatus: "open", note: label });
    if (existing) {
      await recordAudit(tx, {
        userId: actorId,
        entityType: "purchase_order",
        entityId: created.id,
        action: "override",
        note: `Duplicate customer PO number ${parsed.customerPoNumber} confirmed (earlier PO ${existing.id})`,
      });
    }
    return { id: created.id };
  });
}
