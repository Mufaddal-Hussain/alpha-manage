import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { brand, design, priceGroup } from "./catalog";

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
// Catalog essentials (data-model.md "Catalog"): what a quotation needs and what staff can type in by hand.
// Phase 5 added the distributor price-list tables (catalog.ts) and the brand / design / price group / cost /
// margin columns on `product`, which are null for products entered by hand.
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
    /** Set for products created from a price list (null for hand-entered and special items). */
    brandId: uuid("brand_id").references(() => brand.id, { onDelete: "set null" }),
    designId: uuid("design_id").references(() => design.id, { onDelete: "set null" }),
    /** The price group of the current list that supplies the cost price. */
    priceGroupId: uuid("price_group_id").references(() => priceGroup.id, { onDelete: "set null" }),
    hsnCode: text("hsn_code").notNull(),
    /** Full GST percentage (18 = 18%); an editable fact per product, never a constant in code. */
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    /** Rate per `unit`, ex-GST. */
    /** Distributor cost per `unit`, ex-GST, copied from the price group on import. */
    costPerUnit: numeric("cost_per_unit", { precision: 14, scale: 2 }),
    sellingPricePerUnit: numeric("selling_price_per_unit", { precision: 14, scale: 2 }),
    /** Margin on cost, in percent: (selling - cost) / cost x 100. Kept consistent with the selling price. */
    marginPercent: numeric("margin_percent", { precision: 8, scale: 2 }),
    /** An import changed the cost; the selling price has not been looked at since (cleared when it is set). */
    costReviewNeeded: boolean("cost_review_needed").notNull().default(false),
    previousCostPerUnit: numeric("previous_cost_per_unit", { precision: 14, scale: 2 }),
    status: productStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    index("product_name_idx").on(t.name),
    index("product_brand_design_idx").on(t.brandId, t.designId),
    index("product_cost_review_idx").on(t.costReviewNeeded),
    check("product_gst_rate_chk", sql`${t.gstRate} >= 0 AND ${t.gstRate} <= 100`),
    check("product_selling_price_chk", sql`${t.sellingPricePerUnit} IS NULL OR ${t.sellingPricePerUnit} >= 0`),
    check("product_cost_chk", sql`${t.costPerUnit} IS NULL OR ${t.costPerUnit} >= 0`),
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
