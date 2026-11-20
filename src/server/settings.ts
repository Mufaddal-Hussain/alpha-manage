"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { businessProfile, numberSeries, termsTemplate } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/session";
import { ConflictError, NotFoundError, runAction, ValidationError, type ActionResult } from "@/lib/errors";
import { financialYearOf } from "@/lib/financial-year";
import { formValues, optionalText, parseForm } from "@/lib/form";
import { getStateByCode } from "@/lib/gst/state-codes";
import { GSTIN_PATTERN } from "@/lib/gstin";
import { validateFormat } from "@/lib/numbering";
import { deleteStoredFile, saveImageUpload } from "@/lib/storage/files";

// Owner-only mutations for the settings screens (T029). Each action authorises first.

const uuidOrEmpty = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.uuid().nullable());

const businessSchema = z
  .object({
    legalName: z.string().trim().min(1, "Required").max(120),
    tradeName: optionalText(120),
    addressLine1: z.string().trim().min(1, "Required").max(160),
    addressLine2: optionalText(160),
    city: z.string().trim().min(1, "Required").max(80),
    pincode: optionalText(6).refine((v) => v === null || /^\d{6}$/.test(v), "Pincode must be 6 digits"),
    stateCode: z.string().refine((v) => getStateByCode(v) !== undefined, "Choose a state"),
    gstin: optionalText(15)
      .transform((v) => v?.toUpperCase() ?? null)
      .refine((v) => v === null || GSTIN_PATTERN.test(v), "GSTIN must be 15 characters in the standard format"),
    phone: optionalText(30),
    email: optionalText(120).refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email"),
    bankName: optionalText(80),
    bankAccountNo: optionalText(30),
    bankIfsc: optionalText(11)
      .transform((v) => v?.toUpperCase() ?? null)
      .refine((v) => v === null || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "IFSC must look like HDFC0001234"),
    defaultQuotationValidityDays: z.coerce.number().int("Whole days only").min(1, "At least 1 day").max(365),
    defaultTermsTemplateId: uuidOrEmpty,
  })
  .refine((v) => v.gstin === null || v.gstin.startsWith(v.stateCode), {
    path: ["gstin"],
    message: "The first two digits of the GSTIN must match the state code",
  });

function uploaded(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

export async function saveBusinessProfile(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("owner");
    const values = parseForm(businessSchema, formData);
    const raw = formValues(formData);
    const db = getDb();

    const [existing] = await db.select().from(businessProfile).limit(1);
    let logoFileId = existing?.logoFileId ?? null;
    let brandStripFileId = existing?.brandStripFileId ?? null;
    const replaced: string[] = [];

    const newLogo = uploaded(formData, "logo");
    if (newLogo) {
      if (logoFileId) replaced.push(logoFileId);
      logoFileId = (await saveImageUpload(newLogo, user.id)).id;
    } else if (raw.removeLogo === "on") {
      if (logoFileId) replaced.push(logoFileId);
      logoFileId = null;
    }
    const newStrip = uploaded(formData, "brandStrip");
    if (newStrip) {
      if (brandStripFileId) replaced.push(brandStripFileId);
      brandStripFileId = (await saveImageUpload(newStrip, user.id, { maxBytes: 4 * 1024 * 1024 })).id;
    } else if (raw.removeBrandStrip === "on") {
      if (brandStripFileId) replaced.push(brandStripFileId);
      brandStripFileId = null;
    }

    const state = getStateByCode(values.stateCode)!;
    const row = { ...values, state: state.name, logoFileId, brandStripFileId };
    await db.transaction(async (tx) => {
      if (existing) {
        await tx.update(businessProfile).set(row).where(eq(businessProfile.id, existing.id));
      } else {
        await tx.insert(businessProfile).values(row);
      }
      await recordAudit(tx, {
        userId: user.id,
        entityType: "business_profile",
        entityId: existing?.id ?? "new",
        action: existing ? "update" : "create",
      });
    });
    // Old images are removed only once the profile no longer points at them.
    for (const id of replaced) await deleteStoredFile(id);
    revalidatePath("/settings/business");
  }, "Business profile saved");
}

const numberingSchema = z.object({
  series: z.enum(["quotation", "challan"]),
  format: z.string().trim().superRefine((value, ctx) => {
    const problem = validateFormat(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  }),
  nextNumber: z.coerce.number().int("Whole numbers only").min(1, "Must be at least 1").max(99_999_999),
});

export async function saveNumberSeries(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("owner");
    const { series, format, nextNumber } = parseForm(numberingSchema, formData);
    const financialYear = financialYearOf(new Date());

    await getDb().transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(numberSeries)
        .where(and(eq(numberSeries.series, series), eq(numberSeries.financialYear, financialYear)))
        .for("update");

      if (current && current.lastValue > 0 && nextNumber <= current.lastValue) {
        throw new ValidationError("That number is already used", {
          nextNumber: `Numbers up to ${current.lastValue} are already issued; the next number must be ${current.lastValue + 1} or higher`,
        });
      }
      if (current) {
        await tx
          .update(numberSeries)
          .set({ format, lastValue: nextNumber - 1 })
          .where(eq(numberSeries.id, current.id));
      } else {
        await tx.insert(numberSeries).values({ series, financialYear, format, lastValue: nextNumber - 1 });
      }
      await recordAudit(tx, {
        userId: user.id,
        entityType: "number_series",
        entityId: `${series}:${financialYear}`,
        action: "update",
        note: `format ${format}, next number ${nextNumber}`,
      });
    });
    revalidatePath("/settings/numbering");
  }, "Numbering saved");
}

const termsSchema = z.object({
  id: uuidOrEmpty,
  name: z.string().trim().min(1, "Required").max(80),
  clauses: z
    .string()
    .transform((text) =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().max(300, "Each clause is at most 300 characters")).min(1, "Add at least one clause").max(30)),
  makeDefault: z.string().optional(),
});

export async function saveTermsTemplate(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("owner");
    const { id, name, clauses, makeDefault } = parseForm(termsSchema, formData);
    const db = getDb();

    await db.transaction(async (tx) => {
      const [anyDefault] = await tx.select({ id: termsTemplate.id }).from(termsTemplate).where(eq(termsTemplate.isDefault, true));
      let templateId = id;
      if (templateId) {
        const updated = await tx.update(termsTemplate).set({ name, body: clauses }).where(eq(termsTemplate.id, templateId)).returning({ id: termsTemplate.id });
        if (updated.length === 0) throw new NotFoundError("That terms template no longer exists");
      } else {
        const [created] = await tx
          .insert(termsTemplate)
          .values({ name, body: clauses, isDefault: !anyDefault })
          .returning({ id: termsTemplate.id });
        templateId = created.id;
      }
      if (makeDefault === "on") await setDefault(tx, templateId);
      await recordAudit(tx, { userId: user.id, entityType: "terms_template", entityId: templateId, action: id ? "update" : "create" });
    });
    revalidatePath("/settings/terms");
  }, "Terms saved");
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function setDefault(tx: Tx, templateId: string) {
  await tx.update(termsTemplate).set({ isDefault: false }).where(and(eq(termsTemplate.isDefault, true), ne(termsTemplate.id, templateId)));
  await tx.update(termsTemplate).set({ isDefault: true }).where(eq(termsTemplate.id, templateId));
  await tx.update(businessProfile).set({ defaultTermsTemplateId: templateId });
}

export async function setDefaultTermsTemplate(formData: FormData): Promise<void> {
  const user = await requireRole("owner");
  const id = z.uuid().parse(formData.get("id"));
  await getDb().transaction(async (tx) => {
    await setDefault(tx, id);
    await recordAudit(tx, { userId: user.id, entityType: "terms_template", entityId: id, action: "set_default" });
  });
  revalidatePath("/settings/terms");
}

export async function deleteTermsTemplate(formData: FormData): Promise<void> {
  const user = await requireRole("owner");
  const id = z.uuid().parse(formData.get("id"));
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(termsTemplate).where(eq(termsTemplate.id, id));
    if (!row) return;
    if (row.isDefault) throw new ConflictError("The default template cannot be deleted; make another one the default first");
    await tx.delete(termsTemplate).where(eq(termsTemplate.id, id));
    await recordAudit(tx, { userId: user.id, entityType: "terms_template", entityId: id, action: "delete", note: row.name });
  });
  revalidatePath("/settings/terms");
}

