import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { file, user } from "./core";
import { distributor } from "./parties";
import type { PriceRow } from "@/lib/import/price-list-rules";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const priceListStatus = pgEnum("price_list_status", ["draft", "published", "superseded"]);
export const importSourceType = pgEnum("import_source_type", ["excel", "pdf"]);
export const importJobStatus = pgEnum("import_job_status", ["uploaded", "processing", "needs_review", "approved", "failed"]);
export const importRowKind = pgEnum("import_row_kind", ["new", "changed", "unchanged", "error", "removed"]);

// ---------------------------------------------------------------------------
// Distributor price lists (data-model.md "Catalog", FR-008): a distributor carries brands; each brand has dated,
// versioned price lists; a list is made of price groups (size + finish + one price) and each group holds designs.
// ---------------------------------------------------------------------------

export const brand = pgTable(
  "brand",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    distributorId: uuid("distributor_id").references(() => distributor.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  // Brand names are compared without regard to case ("colortile" and "Colortile" are one brand).
  (t) => [uniqueIndex("brand_name_idx").on(sql`lower(${t.name})`), index("brand_distributor_idx").on(t.distributorId)],
);

/** One version of a brand's price list. At most one is `published` (current) per brand; older ones stay readable. */
export const priceList = pgTable(
  "price_list",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brand.id, { onDelete: "restrict" }),
    /** Revision label such as "R6.1". */
    label: text("label"),
    /** The "w.e.f." date. */
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    /** The Excel/CSV the rows were read from. */
    sourceFileId: uuid("source_file_id").references(() => file.id, { onDelete: "set null" }),
    /** The distributor's original PDF, attached for reference only (FR-007); never read by the system. */
    referenceFileId: uuid("reference_file_id").references(() => file.id, { onDelete: "set null" }),
    status: priceListStatus("status").notNull().default("draft"),
    /** The import that created this version (no foreign key: import_job is defined below and deleting a job must not delete history). */
    importJobId: uuid("import_job_id"),
    importedBy: uuid("imported_by").references(() => user.id, { onDelete: "set null" }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("price_list_brand_idx").on(t.brandId, t.effectiveFrom),
    uniqueIndex("price_list_one_published_idx").on(t.brandId).where(sql`${t.status} = 'published'`),
  ],
);

/** A size + finish with one price (one price row of the template). A printed group with two prices is two groups. */
export const priceGroup = pgTable(
  "price_group",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceList.id, { onDelete: "cascade" }),
    sizeLabel: text("size_label").notNull(),
    lengthMm: integer("length_mm"),
    widthMm: integer("width_mm"),
    finish: text("finish").notNull(),
    piecesPerBox: integer("pieces_per_box").notNull(),
    sqftPerBox: numeric("sqft_per_box", { precision: 12, scale: 3 }).notNull(),
    /** Published values, stored as given (never recomputed). INR, ex-GST. */
    ratePerBox: numeric("rate_per_box", { precision: 14, scale: 2 }).notNull(),
    ratePerSqft: numeric("rate_per_sqft", { precision: 14, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    index("price_group_list_idx").on(t.priceListId, t.sortOrder),
    check("price_group_rates_chk", sql`${t.ratePerBox} > 0 AND ${t.ratePerSqft} >= 0`),
    check("price_group_packing_chk", sql`${t.piecesPerBox} > 0 AND ${t.sqftPerBox} > 0`),
  ],
);

/** A design name within a brand ("Imperia Silver"), reusable across price lists so its price history can be traced. */
export const design = pgTable(
  "design",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brand.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("design_brand_name_idx").on(t.brandId, sql`lower(${t.name})`)],
);

export const priceGroupDesign = pgTable(
  "price_group_design",
  {
    priceGroupId: uuid("price_group_id")
      .notNull()
      .references(() => priceGroup.id, { onDelete: "cascade" }),
    designId: uuid("design_id")
      .notNull()
      .references(() => design.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.priceGroupId, t.designId] }), index("price_group_design_design_idx").on(t.designId)],
);

// ---------------------------------------------------------------------------
// Import pipeline (parse -> review -> approve). Nothing reaches the tables above before approval.
// ---------------------------------------------------------------------------

/** Values copied from the business profile when the import starts, so approval does not depend on later edits. */
export interface ImportDefaults {
  hsnCode: string;
  gstRate: string;
}

/** Per-design outcome of the comparison with the brand's current published list. */
export interface ImportDesignDiff {
  name: string;
  kind: "new" | "changed" | "unchanged";
  /** Rate per box in the current list, for `changed`. */
  previousRatePerBox?: string;
}

export interface ImportRowPayload {
  /** The validated row (for `removed` rows: the group the designs came from). Null for `error` rows. */
  row: PriceRow | null;
  designs: ImportDesignDiff[];
  warnings: string[];
  /** The brand is not in the catalog yet and is created on approval. */
  brandIsNew?: boolean;
}

export const importJob = pgTable(
  "import_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The brand the person said the file is for, if any. Rows for another brand are errors. */
    brandId: uuid("brand_id").references(() => brand.id, { onDelete: "set null" }),
    sourceFileId: uuid("source_file_id").references(() => file.id, { onDelete: "set null" }),
    /** Optional original PDF, attached to each price list this import creates (FR-007). */
    referenceFileId: uuid("reference_file_id").references(() => file.id, { onDelete: "set null" }),
    sourceName: text("source_name").notNull(),
    sourceType: importSourceType("source_type").notNull().default("excel"),
    status: importJobStatus("status").notNull().default("uploaded"),
    /** Rows read from the file, for the progress line. */
    rowCount: integer("row_count").notNull().default(0),
    errorSummary: text("error_summary"),
    defaults: jsonb("defaults").$type<ImportDefaults>().notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("import_job_created_idx").on(t.createdAt)],
);

export const importRow = pgTable(
  "import_row",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJob.id, { onDelete: "cascade" }),
    /** Row number in the source file (0 for `removed` rows, which come from the old list). */
    rowNumber: integer("row_number").notNull(),
    /** The cell text as read (or as corrected in review); validation is re-run from this. */
    raw: jsonb("raw").$type<Record<string, string>>().notNull(),
    payload: jsonb("payload").$type<ImportRowPayload>().notNull(),
    kind: importRowKind("kind").notNull(),
    message: text("message"),
    /**
     * For new / changed / unchanged rows: include the row in the new price list version.
     * For `removed` rows: mark the matching products discontinued (default false: keep them active).
     * An `error` row can never be accepted.
     */
    accepted: boolean("accepted").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("import_row_job_idx").on(t.jobId, t.rowNumber), check("import_row_error_not_accepted_chk", sql`${t.kind} <> 'error' OR NOT ${t.accepted}`)],
);

export type Brand = typeof brand.$inferSelect;
export type PriceList = typeof priceList.$inferSelect;
export type PriceGroup = typeof priceGroup.$inferSelect;
export type Design = typeof design.$inferSelect;
export type ImportJob = typeof importJob.$inferSelect;
export type ImportRow = typeof importRow.$inferSelect;
export type ImportRowKind = (typeof importRowKind.enumValues)[number];
