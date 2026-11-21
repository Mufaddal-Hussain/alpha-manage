import { sql } from "drizzle-orm";
import { check, date, index, integer, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { productUnit } from "./catalog-basic";
import { file, user } from "./core";
import { customer } from "./parties";
import { quotation, quotationLine, quotationRevision } from "./quotations";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * `open` until a challan is issued; the later states are kept in step by the challan transactions (Phase 7) and
 * `cancelled` is an owner decision. Delivered/pending quantities are never stored (data-model.md "Derived quantities").
 */
export const purchaseOrderStatus = pgEnum("purchase_order_status", ["open", "partially_delivered", "delivered", "cancelled"]);

// ---------------------------------------------------------------------------
// Customer purchase order (data-model.md "Purchase order (customer PO)")
// ---------------------------------------------------------------------------

/**
 * The customer's PO against an approved quotation. It points at the revision that was approved, so the PO keeps
 * meaning something even if later revisions of the quotation existed.
 *
 * (customer, customer_po_number) is deliberately NOT a unique constraint: a duplicate may be recorded when staff
 * confirm it, and that override is written to the audit log. The check runs in the recording transaction instead
 * (src/server/order-core.ts), under a lock on the customer row so two submissions cannot slip past each other.
 */
export const purchaseOrder = pgTable(
  "purchase_order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotation.id, { onDelete: "restrict" }),
    quotationRevisionId: uuid("quotation_revision_id")
      .notNull()
      .references(() => quotationRevision.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    /** The customer's own PO number, as typed (trimmed). Compared case-insensitively. */
    customerPoNumber: text("customer_po_number").notNull(),
    poDate: date("po_date", { mode: "string" }).notNull(),
    advanceReceived: numeric("advance_received", { precision: 14, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
    status: purchaseOrderStatus("status").notNull().default("open"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("purchase_order_quotation_idx").on(t.quotationId),
    index("purchase_order_customer_idx").on(t.customerId),
    index("purchase_order_status_idx").on(t.status),
    index("purchase_order_customer_po_idx").on(t.customerId, sql`lower(${t.customerPoNumber})`),
    check("purchase_order_advance_chk", sql`${t.advanceReceived} >= 0`),
    check("purchase_order_number_chk", sql`length(btrim(${t.customerPoNumber})) > 0`),
  ],
);

/**
 * One ordered item. Description, HSN, unit, rate, discount and GST are copied from the quotation line when the PO
 * is recorded and never change afterwards (Phase 7 challans copy from here in turn). `quantity_quoted` is kept so the
 * difference from the quotation can always be shown.
 */
export const poLine = pgTable(
  "po_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    /** Null for a line that was not on the quotation (none can be added yet) or whose quotation line is gone. */
    quotationLineId: uuid("quotation_line_id").references(() => quotationLine.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    hsnCode: text("hsn_code").notNull(),
    unit: productUnit("unit").notNull(),
    quantityOrdered: numeric("quantity_ordered", { precision: 12, scale: 3 }).notNull(),
    quantityQuoted: numeric("quantity_quoted", { precision: 12, scale: 3 }),
    rate: numeric("rate", { precision: 14, scale: 2 }).notNull(),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("po_line_no_idx").on(t.purchaseOrderId, t.lineNo),
    index("po_line_quotation_line_idx").on(t.quotationLineId),
    check("po_line_quantity_chk", sql`${t.quantityOrdered} > 0`),
  ],
);

/** Attached PO documents (scans, PDFs, photos). The bytes live in storage; see `file`. */
export const poFile = pgTable(
  "po_file",
  {
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => file.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.purchaseOrderId, t.fileId] }), index("po_file_file_idx").on(t.fileId)],
);

export type PurchaseOrder = typeof purchaseOrder.$inferSelect;
export type PurchaseOrderStatus = (typeof purchaseOrderStatus.enumValues)[number];
export type PoLine = typeof poLine.$inferSelect;
