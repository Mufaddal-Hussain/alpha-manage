import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const userRole = pgEnum("user_role", ["owner", "sales"]);
export const numberSeriesKind = pgEnum("number_series_kind", ["quotation", "challan", "invoice", "receipt"]);

// ---------------------------------------------------------------------------
// Access. `user`, `session`, `account` and `verification` are the tables Better Auth
// reads and writes (model and field names are what its Drizzle adapter expects);
// `role` and `active` are our additional user fields (data-model.md `user`).
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRole("role").notNull().default("sales"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Files (PO attachments, price-list sources, business logo). Bytes live in storage;
// this row maps an id to the storage key.
// ---------------------------------------------------------------------------

export const file = pgTable("file", {
  id: uuid("id").primaryKey().defaultRandom(),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => user.id, { onDelete: "set null" }),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const termsTemplate = pgTable(
  "terms_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Ordered list of clauses, one string per clause. */
    body: jsonb("body").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  // At most one default template.
  (t) => [uniqueIndex("terms_template_one_default_idx").on(t.isDefault).where(sql`${t.isDefault}`)],
);

/** Single-row table: the `singleton` column with its check + unique index allows exactly one row. */
export const businessProfile = pgTable(
  "business_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    singleton: boolean("singleton").notNull().default(true),
    legalName: text("legal_name").notNull(),
    tradeName: text("trade_name"),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    pincode: text("pincode"),
    /** Two-digit GST state code, e.g. "27". Drives intra/inter-state tax mode. */
    stateCode: text("state_code").notNull(),
    gstin: text("gstin"),
    phone: text("phone"),
    email: text("email"),
    logoFileId: uuid("logo_file_id").references(() => file.id, { onDelete: "set null" }),
    brandStripFileId: uuid("brand_strip_file_id").references(() => file.id, { onDelete: "set null" }),
    bankName: text("bank_name"),
    bankAccountNo: text("bank_account_no"),
    bankIfsc: text("bank_ifsc"),
    defaultQuotationValidityDays: integer("default_quotation_validity_days").notNull().default(15),
    /** HSN code and GST rate given to products created by a price-list import. Editable data, never constants in code. */
    defaultHsnCode: text("default_hsn_code"),
    defaultGstRate: numeric("default_gst_rate", { precision: 5, scale: 2 }),
    defaultTermsTemplateId: uuid("default_terms_template_id").references(() => termsTemplate.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    check("business_profile_singleton_chk", sql`${t.singleton}`),
    uniqueIndex("business_profile_singleton_idx").on(t.singleton),
    check("business_profile_state_code_chk", sql`${t.stateCode} ~ '^[0-9]{2}$'`),
  ],
);

/**
 * One row per (series, financial year). `last_value` is bumped only inside the
 * document-creating transaction (see src/lib/numbering.ts), so numbers are gap-free.
 */
export const numberSeries = pgTable(
  "number_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    series: numberSeriesKind("series").notNull(),
    /** Display format, e.g. `QT/{FY}/{N:4}`. */
    format: text("format").notNull(),
    financialYear: text("financial_year").notNull(),
    lastValue: integer("last_value").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("number_series_series_fy_idx").on(t.series, t.financialYear),
    check("number_series_last_value_chk", sql`${t.lastValue} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Audit log (append-only)
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** `create`, `status_change`, `override`, ... */
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId)],
);

export type User = typeof user.$inferSelect;
export type UserRole = (typeof userRole.enumValues)[number];
export type FileRecord = typeof file.$inferSelect;
export type BusinessProfile = typeof businessProfile.$inferSelect;
export type NumberSeries = typeof numberSeries.$inferSelect;
export type NumberSeriesKind = (typeof numberSeriesKind.enumValues)[number];
export type TermsTemplate = typeof termsTemplate.$inferSelect;
