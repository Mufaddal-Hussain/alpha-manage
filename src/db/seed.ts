import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";

// Seed for a fresh database: business profile, default terms, numbering series, one owner user.
// Run with `npm run db:seed`. It only ever adds what is missing (safe to re-run) and never deletes.
loadEnvConfig(process.cwd());

// Details copied from the owner's sample documents. GST rates and HSN codes are NOT seeded here:
// they live on products and charge types and are verified by the customer later.
const BUSINESS = {
  legalName: "Alpha Tiles",
  tradeName: "Alpha Tiles",
  addressLine1: "Shop No. G-4, The Capital Mall, Kausar Baugh",
  addressLine2: "Kondhwa Khurd",
  city: "Pune",
  state: "Maharashtra",
  pincode: "411048",
  stateCode: "27",
  gstin: "27ABYFA7430K1ZT",
  phone: "+91 9021472657",
  email: "alpha.tiles@outlook.com",
} as const;

// The six terms printed on samples/162 Taher bhai.pdf.
const DEFAULT_TERMS = [
  "Payment 100% Advance.",
  "Delivery Ex-Godown / Showroom",
  "We Are Not Responsible For Any Kind Of Breakage During Transit.",
  "Unloading Will Be Customer Responsibility",
  "Goods Once Sold Will Not Be Taken Back",
  "No Complaints Will Be Entertained After Laying The Tiles",
];

// Non-product charges. HSN/SAC and GST rate are placeholders from the Radius 9 delivery note (transport 8704 at
// 9% + 9%) until the business verifies them; they are editable data, never constants in code.
const CHARGE_TYPES = [
  { name: "Transport Charges", hsnSacCode: "8704", gstRate: "18" },
  { name: "Loading", hsnSacCode: "9967", gstRate: "18" },
] as const;

async function main() {
  // Imported after loadEnvConfig so env validation sees .env.local.
  const { getDb } = await import("@/db");
  const { businessProfile, chargeType, numberSeries, termsTemplate, user } = await import("@/db/schema");
  const { recordAudit } = await import("@/lib/audit");
  const { createStaffUser } = await import("@/lib/auth/create-user");
  const { financialYearOf } = await import("@/lib/financial-year");
  const { DEFAULT_FORMATS } = await import("@/lib/numbering");

  const db = getDb();

  // 1. Default terms template
  let [terms] = await db.select().from(termsTemplate).where(eq(termsTemplate.isDefault, true)).limit(1);
  if (!terms) {
    [terms] = await db
      .insert(termsTemplate)
      .values({ name: "Standard terms", body: DEFAULT_TERMS, isDefault: true })
      .returning();
    console.log("Created default terms template (6 clauses).");
  }

  // 2. Business profile (single row)
  const [profile] = await db.select({ id: businessProfile.id }).from(businessProfile).limit(1);
  if (!profile) {
    await db.insert(businessProfile).values({ ...BUSINESS, defaultTermsTemplateId: terms.id });
    console.log("Created the Alpha Tiles business profile.");
  }

  // 3. Numbering series for the current financial year
  const financialYear = financialYearOf(new Date());
  for (const series of ["quotation", "challan"] as const) {
    const inserted = await db
      .insert(numberSeries)
      .values({ series, financialYear, format: DEFAULT_FORMATS[series], lastValue: 0 })
      .onConflictDoNothing()
      .returning({ id: numberSeries.id });
    if (inserted.length) console.log(`Created ${series} numbering for ${financialYear} (${DEFAULT_FORMATS[series]}).`);
  }

  // 4. Charge types for quotations (added by name; existing ones are left as the business edited them)
  for (const charge of CHARGE_TYPES) {
    const [existing] = await db.select({ id: chargeType.id }).from(chargeType).where(eq(chargeType.name, charge.name)).limit(1);
    if (!existing) {
      await db.insert(chargeType).values(charge);
      console.log(`Created charge type ${charge.name} (HSN/SAC ${charge.hsnSacCode}, GST ${charge.gstRate}%: confirm with the business).`);
    }
  }

  // 5. Owner user
  const [existingOwner] = await db.select({ email: user.email }).from(user).where(eq(user.role, "owner")).limit(1);
  if (existingOwner) {
    console.log(`An owner already exists (${existingOwner.email}); no user created and no password changed.`);
  } else {
    const email = (process.env.SEED_OWNER_EMAIL || BUSINESS.email).trim().toLowerCase();
    const password = randomBytes(18).toString("base64url");
    const owner = await createStaffUser({ name: "Owner", email, password, role: "owner" });
    await recordAudit(db, { userId: null, entityType: "user", entityId: owner.id, action: "create", note: "seed owner" });
    console.log("");
    console.log("Owner account created. Save this password now; it is shown only once and is not stored anywhere.");
    console.log(`  email:    ${email}`);
    console.log(`  password: ${password}`);
    console.log("");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
