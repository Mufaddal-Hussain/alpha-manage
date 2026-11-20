import { sql } from "drizzle-orm";
import { boolean, check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const customerType = pgEnum("customer_type", ["individual", "company"]);

/** Same pattern as src/lib/gstin.ts; kept in the database too so no code path can store a bad GSTIN. */
const GSTIN_SQL = "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$";

// ---------------------------------------------------------------------------
// Customers (data-model.md "Parties")
// ---------------------------------------------------------------------------

export const customer = pgTable(
  "customer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: customerType("type").notNull(),
    displayName: text("display_name").notNull(),
    legalName: text("legal_name"),
    /** Optional for individuals; when given it is format-validated and its first two digits equal `state_code`. */
    gstin: text("gstin"),
    pan: text("pan"),
    /** Two-digit GST state code of the billing address; decides intra/inter-state tax on documents. */
    stateCode: text("state_code").notNull(),
    // Billing address
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    pincode: text("pincode"),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("customer_display_name_idx").on(t.displayName),
    index("customer_gstin_idx").on(t.gstin),
    check("customer_state_code_chk", sql`${t.stateCode} ~ '^[0-9]{2}$'`),
    check("customer_gstin_format_chk", sql.raw(`"gstin" IS NULL OR "gstin" ~ '${GSTIN_SQL}'`)),
    check("customer_gstin_state_chk", sql`${t.gstin} IS NULL OR left(${t.gstin}, 2) = ${t.stateCode}`),
  ],
);

/** Shipping destinations, e.g. "Koregaon Park site". */
export const customerAddress = pgTable(
  "customer_address",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city"),
    pincode: text("pincode"),
    stateCode: text("state_code").notNull(),
    isDefaultShipping: boolean("is_default_shipping").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("customer_address_customer_idx").on(t.customerId),
    // At most one default shipping address per customer.
    uniqueIndex("customer_address_one_default_idx")
      .on(t.customerId)
      .where(sql`${t.isDefaultShipping}`),
    check("customer_address_state_code_chk", sql`${t.stateCode} ~ '^[0-9]{2}$'`),
  ],
);

/** Site contact persons, as on the Taher bhai sheet. */
export const customerContact = pgTable(
  "customer_contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    role: text("role"),
    ...timestamps,
  },
  (t) => [index("customer_contact_customer_idx").on(t.customerId)],
);

/** Suppliers the tiles are bought from (Fun Enterprises, SHCO, ...); brands hang off these in Phase 5. */
export const distributor = pgTable(
  "distributor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    gstin: text("gstin"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  () => [check("distributor_gstin_format_chk", sql.raw(`"gstin" IS NULL OR "gstin" ~ '${GSTIN_SQL}'`))],
);

export type Customer = typeof customer.$inferSelect;
export type CustomerType = (typeof customerType.enumValues)[number];
export type CustomerAddress = typeof customerAddress.$inferSelect;
export type CustomerContact = typeof customerContact.$inferSelect;
export type Distributor = typeof distributor.$inferSelect;
