import { sql } from "drizzle-orm";
import type { Database } from "@/db";
import type { PurchaseOrderStatus } from "@/db/schema";
import { dec } from "@/lib/money";

/** Anything that can run SQL: the database client or, normally, the caller's transaction. */
type Executor = Pick<Database, "execute">;

/** Ordered, delivered and pending for one PO line. Quantities are NUMERIC text (3 decimals). */
export interface LineQuantity {
  poLineId: string;
  lineNo: number;
  ordered: string;
  /** SUM of the quantities on challans that are issued (cancelled challans do not count). Never stored. */
  delivered: string;
  /** `ordered - delivered`, not below zero. */
  pending: string;
  /** How much more than ordered has gone out (only an owner override can cause it); "0.000" otherwise. */
  excess: string;
}

/** Derives pending and excess from ordered and delivered (pure). */
export function lineQuantity(poLineId: string, lineNo: number, ordered: string, delivered: string): LineQuantity {
  const gap = dec(ordered).minus(delivered);
  return {
    poLineId,
    lineNo,
    ordered: dec(ordered).toFixed(3),
    delivered: dec(delivered).toFixed(3),
    pending: (gap.isNegative() ? dec(0) : gap).toFixed(3),
    excess: (gap.isNegative() ? gap.negated() : dec(0)).toFixed(3),
  };
}

/**
 * The PO status that follows from the delivered quantities: `open` when nothing has been delivered, `delivered` when
 * every line has received at least what was ordered, `partially_delivered` in between. A cancelled PO stays cancelled.
 */
export function statusFromQuantities(lines: Pick<LineQuantity, "ordered" | "delivered">[], current: PurchaseOrderStatus): PurchaseOrderStatus {
  if (current === "cancelled") return "cancelled";
  if (lines.length === 0) return "open";
  const anyDelivered = lines.some((l) => dec(l.delivered).gt(0));
  if (!anyDelivered) return "open";
  const allDelivered = lines.every((l) => dec(l.delivered).gte(l.ordered));
  return allDelivered ? "delivered" : "partially_delivered";
}

/**
 * Ordered / delivered / pending per line of a PO, computed from the issued challans every time (data-model.md "Derived
 * quantities"). Pass the transaction when the figures are used to decide something, after locking the PO's lines.
 */
export async function getLineQuantities(executor: Executor, purchaseOrderId: string): Promise<LineQuantity[]> {
  const result = await executor.execute<{ id: string; line_no: number; ordered: string; delivered: string }>(sql`
    SELECT
      pl.id,
      pl.line_no,
      pl.quantity_ordered::text AS ordered,
      COALESCE(SUM(cl.quantity) FILTER (WHERE dc.status = 'issued'), 0)::text AS delivered
    FROM po_line pl
    LEFT JOIN challan_line cl ON cl.po_line_id = pl.id
    LEFT JOIN delivery_challan dc ON dc.id = cl.challan_id
    WHERE pl.purchase_order_id = ${purchaseOrderId}
    GROUP BY pl.id, pl.line_no, pl.quantity_ordered
    ORDER BY pl.line_no
  `);
  return result.rows.map((r) => lineQuantity(r.id, r.line_no, r.ordered, r.delivered));
}
