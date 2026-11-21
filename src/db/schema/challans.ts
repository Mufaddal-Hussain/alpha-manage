import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { productUnit } from "./catalog-basic";
import { user } from "./core";
import { poLine, purchaseOrder } from "./orders";
import { customer } from "./parties";
import { taxModeEnum } from "./quotations";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** A challan is `issued` when created and can only move to `cancelled`; it is never deleted and its number is never reused. */
export const challanStatus = pgEnum("challan_status", ["issued", "cancelled"]);

// ---------------------------------------------------------------------------
// Delivery challan (data-model.md "Delivery challan")
// ---------------------------------------------------------------------------

/**
 * One dispatch against a PO. Consignee and buyer are snapshots (FR-031), so editing the customer later never changes a
 * challan that was already printed. Delivered quantities are NOT stored on the PO: they are always the SUM of the lines
 * of challans whose status is `issued` (src/lib/challan/pending.ts).
 */
export const deliveryChallan = pgTable(
  "delivery_challan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** From the `challan` number series, e.g. `CH/2026-27/0001`. Kept when the challan is cancelled. */
    number: text("number").notNull().unique(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    challanDate: date("challan_date", { mode: "string" }).notNull(),
    // Consignee (ship-to) snapshot
    consigneeName: text("consignee_name").notNull(),
    consigneeGstin: text("consignee_gstin"),
    consigneeAddress: text("consignee_address"),
    consigneeStateCode: text("consignee_state_code").notNull(),
    // Buyer (bill-to) snapshot
    buyerName: text("buyer_name").notNull(),
    buyerGstin: text("buyer_gstin"),
    buyerAddress: text("buyer_address"),
    buyerStateCode: text("buyer_state_code").notNull(),
    /** Intra/inter-state as on the approved quotation: decides CGST+SGST or IGST when prices are printed. */
    taxMode: taxModeEnum("tax_mode").notNull(),
    // Tally-style header fields (document-layouts.md section 3)
    modeTermsOfPayment: text("mode_terms_of_payment"),
    referenceNoDate: text("reference_no_date"),
    otherReferences: text("other_references"),
    /** The customer's PO number and date, as text, copied from the PO. */
    buyersOrderNoDate: text("buyers_order_no_date"),
    dispatchDocNo: text("dispatch_doc_no"),
    dispatchedThrough: text("dispatched_through"),
    destination: text("destination"),
    termsOfDelivery: text("terms_of_delivery"),
    vehicleNo: text("vehicle_no"),
    driverName: text("driver_name"),
    driverPhone: text("driver_phone"),
    /** Default for the PDF: rates, tax and totals are printed only when true (the PDF route can override per print). */
    showPrices: boolean("show_prices").notNull().default(false),
    status: challanStatus("status").notNull().default("issued"),
    /** The reason an owner gave for delivering more than was pending on at least one line. */
    overrideReason: text("override_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    cancelledBy: uuid("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("delivery_challan_po_idx").on(t.purchaseOrderId),
    index("delivery_challan_customer_idx").on(t.customerId),
    index("delivery_challan_status_idx").on(t.status),
    index("delivery_challan_date_idx").on(t.challanDate),
    // A cancelled challan always says when and why.
    check("delivery_challan_cancel_chk", sql`${t.status} = 'issued' OR (${t.cancelledAt} IS NOT NULL AND ${t.cancelReason} IS NOT NULL)`),
  ],
);

/**
 * One delivered item. Description, HSN, unit and the price fields are copied from the PO line when the challan is
 * issued. The rate is always stored; whether it is printed depends on `show_prices` (or the print option).
 */
export const challanLine = pgTable(
  "challan_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challanId: uuid("challan_id")
      .notNull()
      .references(() => deliveryChallan.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    poLineId: uuid("po_line_id")
      .notNull()
      .references(() => poLine.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    hsnCode: text("hsn_code").notNull(),
    unit: productUnit("unit").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    rate: numeric("rate", { precision: 14, scale: 2 }).notNull(),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("challan_line_no_idx").on(t.challanId, t.lineNo),
    index("challan_line_po_line_idx").on(t.poLineId),
    check("challan_line_quantity_chk", sql`${t.quantity} > 0`),
  ],
);

export type DeliveryChallan = typeof deliveryChallan.$inferSelect;
export type ChallanStatus = (typeof challanStatus.enumValues)[number];
export type ChallanLine = typeof challanLine.$inferSelect;
