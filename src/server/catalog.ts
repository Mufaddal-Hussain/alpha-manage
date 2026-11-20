"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { brand, businessProfile, distributor, product } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireRole, requireUser } from "@/lib/auth/session";
import { resolveSelling } from "@/lib/catalog/pricing";
import { ConflictError, NotFoundError, runAction, ValidationError, type ActionResult } from "@/lib/errors";
import { formValues, optionalText, parseForm } from "@/lib/form";
import { GSTIN_PATTERN } from "@/lib/gstin";
import { deleteStoredFile, saveDocumentUpload } from "@/lib/storage/files";
import { approveImportJob, correctImportRow, createImportJob, discontinueProduct, setImportRowAccepted, updateSellingPrice } from "./catalog-core";

// Server actions of the catalog (T057-T060). Import and selling-price actions are open to any signed-in staff member
// (contracts/ui-routes.md); brand and distributor management is owner-only. Each action authorises first.

function catalogPaths(...extra: string[]) {
  for (const path of ["/catalog/products", "/catalog/brands", "/catalog/price-lists", ...extra]) revalidatePath(path);
}

// --- Importing a price list -------------------------------------------------------------------------------------

function uploaded(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

/** Reads the uploaded template, stores it (and the optional reference PDF), and opens the review screen. */
export async function startPriceListImport(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const user = await requireUser();
    const template = uploaded(formData, "file");
    if (!template) throw new ValidationError("Choose the filled-in template to import", { file: "Required" });
    const reference = uploaded(formData, "reference");
    const brandId = z.uuid().safeParse(formData.get("brandId")).data ?? null;

    const db = getDb();
    const [profile] = await db.select({ hsn: businessProfile.defaultHsnCode, gst: businessProfile.defaultGstRate }).from(businessProfile).limit(1);
    if (!profile?.hsn || !profile.gst) {
      throw new ValidationError("Set the default HSN code and GST rate under Settings → Business profile first; new products take them.");
    }

    const stored: string[] = [];
    try {
      const source = await saveDocumentUpload(template, user.id, "template");
      stored.push(source.record.id);
      let referenceFileId: string | null = null;
      if (reference) {
        referenceFileId = (await saveDocumentUpload(reference, user.id, "reference")).record.id;
        stored.push(referenceFileId);
      }
      const { jobId } = await createImportJob(db, user.id, {
        fileName: source.record.originalName,
        bytes: source.bytes,
        expectedBrandId: brandId,
        sourceFileId: source.record.id,
        referenceFileId,
        defaults: { hsnCode: profile.hsn, gstRate: String(Number(profile.gst)) },
      });
      return jobId;
    } catch (error) {
      for (const id of stored) await deleteStoredFile(id); // no orphan uploads when the import could not start
      throw error;
    }
  });
  if (result.ok && typeof result.data === "string") redirect(`/catalog/import/${result.data}`);
  return result as ActionResult;
}

/** Approve: the accepted rows become the new price list version(s); nothing is saved before this. */
export async function approveImport(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const user = await requireUser();
    const jobId = z.uuid().parse(formData.get("jobId"));
    const done = await approveImportJob(getDb(), user.id, jobId);
    catalogPaths(`/catalog/import/${jobId}`);
    return done;
  });
  if (!result.ok) return result;
  return {
    ok: true,
    message: "Import approved. Changed costs are flagged on the products; selling prices were not touched.",
  };
}

/** Accept or skip one row of the review (for a removed design: discontinue or keep). */
export async function setImportRowDecision(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.uuid().parse(formData.get("rowId"));
  const accepted = formData.get("accepted") === "1";
  try {
    await setImportRowAccepted(getDb(), user.id, id, accepted);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError) {
      // The review page shows the current state; there is nothing to add for a stale click.
    } else throw error;
  }
  revalidatePath("/catalog/import/[jobId]", "page");
}

/** Replace the values of a row in review; it is validated and compared again. */
export async function fixImportRow(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const id = z.uuid().parse(formData.get("rowId"));
    await correctImportRow(getDb(), user.id, id, formValues(formData));
    revalidatePath("/catalog/import/[jobId]", "page");
  }, "Row updated");
}

// --- Selling price and margin ------------------------------------------------------------------------------------

const priceFields = z.object({
  id: z.uuid(),
  sellingPricePerUnit: z.string().trim(),
  marginPercent: z.string().trim().optional().default(""),
});

/**
 * Sets the selling price or the margin on cost (whichever was changed on the form); the other follows.
 * Open to sales staff. Setting it counts as the review of a changed cost.
 */
export async function setSellingPrice(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseForm(priceFields, formData);
    const db = getDb();
    const [p] = await db.select().from(product).where(eq(product.id, input.id));
    if (!p) throw new NotFoundError("That product no longer exists");
    const resolved = resolveSelling({
      cost: p.costPerUnit,
      currentPrice: p.sellingPricePerUnit,
      currentMargin: p.marginPercent,
      price: input.sellingPricePerUnit,
      margin: input.marginPercent,
    });
    // A form that changes nothing still counts as having looked at the price (it clears a cost-change flag).
    await updateSellingPrice(db, user.id, input.id, { price: resolved.price });
    revalidatePath("/catalog/products");
    revalidatePath(`/catalog/products/${input.id}`);
  }, "Selling price saved");
}

/** Discontinued products stay on old quotations but cannot be added to new ones. Owner only. */
export async function markProductDiscontinued(formData: FormData): Promise<void> {
  const user = await requireRole("owner");
  await discontinueProduct(getDb(), user.id, z.uuid().parse(formData.get("id")));
  catalogPaths();
}

// --- Distributors and brands (owner) -----------------------------------------------------------------------------

const distributorSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  gstin: optionalText(15)
    .transform((v) => v?.toUpperCase() ?? null)
    .refine((v) => v === null || GSTIN_PATTERN.test(v), "GSTIN must be 15 characters in the standard format"),
  phone: optionalText(30),
  email: optionalText(120).refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email"),
  // Not on the "add" form; the edit form sends them.
  address: optionalText(300).optional(),
  notes: optionalText(500).optional(),
});

export async function createDistributor(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("owner");
    const values = parseForm(distributorSchema, formData);
    await getDb().transaction(async (tx) => {
      const [row] = await tx.insert(distributor).values(values).returning({ id: distributor.id });
      await recordAudit(tx, { userId: user.id, entityType: "distributor", entityId: row.id, action: "create", note: values.name });
    });
    catalogPaths();
  }, "Distributor added");
}

const brandSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  distributorId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.uuid().nullable()),
});

export async function createBrand(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("owner");
    const values = parseForm(brandSchema, formData);
    await getDb().transaction(async (tx) => {
      const [clash] = await tx.select({ id: brand.id }).from(brand).where(sql`lower(${brand.name}) = lower(${values.name})`);
      if (clash) throw new ValidationError("A brand with that name already exists", { name: "Already exists" });
      const [row] = await tx.insert(brand).values(values).returning({ id: brand.id });
      await recordAudit(tx, { userId: user.id, entityType: "brand", entityId: row.id, action: "create", note: values.name });
    });
    catalogPaths();
  }, "Brand added");
}

const brandEditSchema = brandSchema.extend({ id: z.uuid(), active: z.string().optional() });

/** Rename a brand, move it to another distributor, or switch it off (inactive brands are left out of pickers). */
export async function saveBrand(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("owner");
    const values = parseForm(brandEditSchema, formData);
    await getDb().transaction(async (tx) => {
      const [clash] = await tx
        .select({ id: brand.id })
        .from(brand)
        .where(and(sql`lower(${brand.name}) = lower(${values.name})`, ne(brand.id, values.id)));
      if (clash) throw new ValidationError("A brand with that name already exists", { name: "Already exists" });
      const updated = await tx
        .update(brand)
        .set({ name: values.name, distributorId: values.distributorId, active: values.active === "on" })
        .where(eq(brand.id, values.id))
        .returning({ id: brand.id });
      if (updated.length === 0) throw new NotFoundError("That brand no longer exists");
      await recordAudit(tx, { userId: user.id, entityType: "brand", entityId: values.id, action: "update", note: values.name });
    });
    catalogPaths();
  }, "Brand saved");
}

export async function saveDistributor(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("owner");
    const id = z.uuid().parse(formData.get("id"));
    const values = parseForm(distributorSchema, formData);
    const active = formData.get("active") === "on";
    await getDb().transaction(async (tx) => {
      const updated = await tx.update(distributor).set({ ...values, active }).where(eq(distributor.id, id)).returning({ id: distributor.id });
      if (updated.length === 0) throw new NotFoundError("That distributor no longer exists");
      await recordAudit(tx, { userId: user.id, entityType: "distributor", entityId: id, action: "update", note: values.name });
    });
    catalogPaths();
  }, "Distributor saved");
}
