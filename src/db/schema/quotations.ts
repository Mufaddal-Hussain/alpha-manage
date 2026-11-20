import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { chargeType, product, productUnit } from "./catalog-basic";
import { file, user } from "./core";
import { customer } from "./parties";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Stored statuses. "Expired" is not stored: a `sent` quotation whose current revision's `valid_until`
 * has passed is shown as expired (src/lib/quotation/status.ts), so no job has to flip it.
 */
export const quotationStatus = pgEnum("quotation_status", ["draft", "sent", "approved", "rejected"]);
export const taxModeEnum = pgEnum("tax_mode", ["intra", "inter"]);
export const quotationLayout = pgEnum("quotation_layout", ["gst_quotation", "estimate"]);
export const quotationLineKind = pgEnum("quotation_line_kind", ["product", "charge"]);

// ---------------------------------------------------------------------------
// Quotation (data-model.md "Quotation")
// ---------------------------------------------------------------------------

/**
 * The stable identity of a quotation. `number` stays null until the first issue so abandoned drafts never
 * use up a gap-free number; revisions keep it.
 */
export const quotation = pgTable(
  "quotation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    status: quotationStatus("status").notNull().default("draft"),
    currentRevisionId: uuid("current_revision_id").references((): AnyPgColumn => quotationRevision.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("quotation_customer_idx").on(t.customerId),
    index("quotation_status_idx").on(t.status),
    // Only a draft may be unnumbered; once it leaves draft the number exists.
    check("quotation_number_chk", sql`${t.status} = 'draft' OR ${t.number} IS NOT NULL`),
  ],
);

/** One edit-after-send per row. Customer details are snapshots copied onto the revision. */
export const quotationRevision = pgTable(
  "quotation_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quotationId: uuid("quotation_id")
      .notNull()
      .references((): AnyPgColumn => quotation.id, { onDelete: "cascade" }),
    revisionNo: integer("revision_no").notNull(),
    quotationDate: date("quotation_date", { mode: "string" }).notNull(),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    // Bill-to snapshot
    billToName: text("bill_to_name").notNull(),
    billToGstin: text("bill_to_gstin"),
    billToAddress: text("bill_to_address"),
    billToStateCode: text("bill_to_state_code").notNull(),
    // Ship-to snapshot
    shipToName: text("ship_to_name"),
    shipToAddress: text("ship_to_address"),
    shipToStateCode: text("ship_to_state_code"),
    siteContactName: text("site_contact_name"),
    siteContactPhone: text("site_contact_phone"),
    placeOfSupplyStateCode: text("place_of_supply_state_code").notNull(),
    taxMode: taxModeEnum("tax_mode").notNull(),
    layout: quotationLayout("layout").notNull().default("gst_quotation"),
    termsText: text("terms_text"),
    advanceAmount: numeric("advance_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
    cgstTotal: numeric("cgst_total", { precision: 14, scale: 2 }).notNull().default("0"),
    sgstTotal: numeric("sgst_total", { precision: 14, scale: 2 }).notNull().default("0"),
    igstTotal: numeric("igst_total", { precision: 14, scale: 2 }).notNull().default("0"),
    roundOff: numeric("round_off", { precision: 14, scale: 2 }).notNull().default("0"),
    grandTotal: numeric("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
    totalInWords: text("total_in_words"),
    notes: text("notes"),
    /** Set when the revision is issued: from then on its figures never change. */
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Cached PDF (regenerated when the revision or layout changes). */
    pdfFileId: uuid("pdf_file_id").references(() => file.id, { onDelete: "set null" }),
    pdfLayout: quotationLayout("pdf_layout"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("quotation_revision_no_idx").on(t.quotationId, t.revisionNo),
    check("quotation_revision_dates_chk", sql`${t.validUntil} >= ${t.quotationDate}`),
    check("quotation_revision_advance_chk", sql`${t.advanceAmount} >= 0`),
  ],
);

export const quotationLine = pgTable(
  "quotation_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => quotationRevision.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    kind: quotationLineKind("kind").notNull().default("product"),
    /** Null for free-text items and charge lines; kept when the product later changes (snapshot below). */
    productId: uuid("product_id").references(() => product.id, { onDelete: "set null" }),
    chargeTypeId: uuid("charge_type_id").references(() => chargeType.id, { onDelete: "set null" }),
    // Snapshot copied when the line was added and frozen at issue (FR-014)
    description: text("description").notNull(),
    hsnCode: text("hsn_code").notNull(),
    unit: productUnit("unit").notNull(),
    piecesPerBox: integer("pieces_per_box"),
    sqftPerBox: numeric("sqft_per_box", { precision: 12, scale: 3 }),
    /** In `unit`. For a box product this is a whole number of boxes. */
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    /** The other measure for display: sq.ft covered by the boxes, or boxes covering the sq.ft. */
    quantityAlt: numeric("quantity_alt", { precision: 12, scale: 3 }),
    rate: numeric("rate", { precision: 14, scale: 2 }).notNull(),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
    taxableValue: numeric("taxable_value", { precision: 14, scale: 2 }).notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    cgstAmount: numeric("cgst_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    sgstAmount: numeric("sgst_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    igstAmount: numeric("igst_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("quotation_line_no_idx").on(t.revisionId, t.lineNo),
    check("quotation_line_quantity_chk", sql`${t.quantity} > 0`),
    check("quotation_line_discount_chk", sql`${t.discountPercent} >= 0 AND ${t.discountPercent} <= 100`),
  ],
);

export type Quotation = typeof quotation.$inferSelect;
export type QuotationStatus = (typeof quotationStatus.enumValues)[number];
export type QuotationRevision = typeof quotationRevision.$inferSelect;
export type QuotationLayout = (typeof quotationLayout.enumValues)[number];
export type QuotationLine = typeof quotationLine.$inferSelect;
