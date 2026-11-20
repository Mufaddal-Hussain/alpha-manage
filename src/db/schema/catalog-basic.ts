import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const productUnit = pgEnum("product_unit", ["box", "sqft", "piece"]);
export const productStatus = pgEnum("product_status", ["active", "discontinued"]);

// ---------------------------------------------------------------------------
// Catalog essentials (data-model.md "Catalog"). Only what a quotation needs and what staff can type in by
// hand lives here; Phase 5 extends `product` with brand, design, price group, cost and margin and adds the
// price-list tables, so none of those columns exist yet.
// ---------------------------------------------------------------------------

/** The sellable item: a tile in a size and finish, granite, or any free-text special item (FR-008a, FR-008b). */
export const product = pgTable(
  "product",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    code: text("code"),
    sizeLabel: text("size_label"),
    finish: text("finish"),
    /** What it is sold in and priced per: a box, a sq.ft, or a piece. */
    unit: productUnit("unit").notNull(),
    piecesPerBox: integer("pieces_per_box"),
    /** Null for items with no box packing (granite). Needed to show the box <-> sq.ft equivalent. */
    sqftPerBox: numeric("sqft_per_box", { precision: 12, scale: 3 }),
    hsnCode: text("hsn_code").notNull(),
    /** Full GST percentage (18 = 18%); an editable fact per product, never a constant in code. */
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    /** Rate per `unit`, ex-GST. */
    sellingPricePerUnit: numeric("selling_price_per_unit", { precision: 14, scale: 2 }),
    status: productStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    index("product_name_idx").on(t.name),
    check("product_gst_rate_chk", sql`${t.gstRate} >= 0 AND ${t.gstRate} <= 100`),
    check("product_selling_price_chk", sql`${t.sellingPricePerUnit} IS NULL OR ${t.sellingPricePerUnit} >= 0`),
    check("product_sqft_per_box_chk", sql`${t.sqftPerBox} IS NULL OR ${t.sqftPerBox} > 0`),
    // A box product needs its packing, otherwise the sq.ft equivalent cannot be shown.
    check("product_box_needs_packing_chk", sql`${t.unit} <> 'box' OR ${t.sqftPerBox} IS NOT NULL`),
  ],
);

/** Non-product charges (Transport Charges, Loading) with their own HSN/SAC code and GST rate. */
export const chargeType = pgTable(
  "charge_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    hsnSacCode: text("hsn_sac_code").notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [check("charge_type_gst_rate_chk", sql`${t.gstRate} >= 0 AND ${t.gstRate} <= 100`)],
);

export type Product = typeof product.$inferSelect;
export type ProductUnit = (typeof productUnit.enumValues)[number];
export type ChargeType = typeof chargeType.$inferSelect;
