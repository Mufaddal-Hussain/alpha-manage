import { z } from "zod";
import { ValidationError } from "@/lib/errors";

// Validation for what the quotation editor submits (contracts/http-endpoints.md `saveQuotationDraft`;
// data-model.md "Validation rules"). Shared by the server and tests; no database or framework imports.

/** A decimal typed as text or number, kept as text so no float ever touches money. */
const decimalText = (label: string, fractionDigits: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => new RegExp(`^\\d+(\\.\\d{1,${fractionDigits}})?$`).test(v), `${label} must be a number${fractionDigits === 0 ? "" : ` with at most ${fractionDigits} decimals`}`);

const optionalString = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

const stateCode = z.string().trim().regex(/^\d{2}$/, "Choose a state");
const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date`)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), `${label} must be a real date`);

export const draftLineSchema = z.object({
  kind: z.enum(["product", "charge"]),
  productId: z.uuid().nullish().transform((v) => v ?? null),
  chargeTypeId: z.uuid().nullish().transform((v) => v ?? null),
  description: z.string().trim().min(1, "Every line needs a description").max(300),
  hsnCode: z.string().trim().max(12, "HSN/SAC code is too long").default(""),
  unit: z.enum(["box", "sqft", "piece"]),
  piecesPerBox: z.number().int().positive().nullish().transform((v) => v ?? null),
  sqftPerBox: decimalText("Sq.ft per box", 3).nullish().transform((v) => v ?? null),
  /** In `unit`; a whole number of boxes for box items. */
  quantity: decimalText("Quantity", 3),
  rate: decimalText("Rate", 2),
  discountPercent: decimalText("Discount", 2).default("0"),
  gstRate: decimalText("GST rate", 2),
});

export const draftSchema = z
  .object({
    quotationId: z.uuid().nullish().transform((v) => v ?? null),
    customerId: z.uuid("Choose a customer"),
    quotationDate: isoDate("Quotation date").nullish().transform((v) => v ?? null),
    validUntil: isoDate("Valid until"),
    billTo: z.object({
      name: z.string().trim().min(1, "Bill-to name is required").max(160),
      gstin: optionalString(15),
      address: optionalString(500),
      stateCode,
    }),
    shipTo: z.object({
      name: optionalString(160),
      address: optionalString(500),
      stateCode: stateCode.nullish().transform((v) => v ?? null),
      contactName: optionalString(120),
      contactPhone: optionalString(30),
    }),
    layout: z.enum(["gst_quotation", "estimate"]),
    terms: optionalString(5000),
    advanceAmount: decimalText("Advance", 2).default("0"),
    notes: optionalString(2000),
    lines: z.array(draftLineSchema).min(1, "A quotation needs at least one line").max(200, "At most 200 lines"),
  })
  .superRefine((value, ctx) => {
    if (value.quotationDate && value.validUntil < value.quotationDate) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Valid until cannot be before the quotation date" });
    }
  });

export type DraftInput = z.input<typeof draftSchema>;
export type ParsedDraft = z.output<typeof draftSchema>;
export type ParsedDraftLine = z.output<typeof draftLineSchema>;

/** Validates an editor payload; the error message is the first problem, in words (with the line number for line errors). */
export function parseDraft(input: unknown): ParsedDraft {
  const result = draftSchema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  const first = result.error.issues[0];
  const path = first.path;
  const lineIndex = path[0] === "lines" && typeof path[1] === "number" ? path[1] + 1 : null;
  const message = lineIndex ? `Line ${lineIndex}: ${first.message}` : first.message;
  throw new ValidationError(message, fieldErrors);
}
