import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { getStateByCode } from "@/lib/gst/state-codes";
import { GSTIN_PATTERN } from "@/lib/gstin";

// Validation for what the "New challan" form submits (contracts/http-endpoints.md `createChallan`). Shared by the
// server and the tests; no database or framework imports.

const decimalText = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d+(\.\d{1,3})?$/.test(v), `${label} must be a number with at most 3 decimals`);

/** Optional text: trimmed, limited in length, empty becomes null. */
const optional = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (at most ${max} characters)`)
    .nullish()
    .transform((v) => (v ? v : null));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Challan date must be a date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Challan date must be a real date");

export const challanLineSchema = z.object({
  poLineId: z.uuid("That item is not on this PO"),
  /** In the line's unit; a whole number of boxes for box items (checked against the PO line by the server). */
  quantity: decimalText("Quantity").refine((v) => Number(v) > 0, "Quantity must be more than zero"),
});

export const challanSchema = z.object({
  purchaseOrderId: z.uuid("That PO could not be found"),
  challanDate: isoDate,
  /** Where the goods go. Defaults to the ship-to of the approved quotation; staff may change it for this dispatch. */
  consignee: z
    .object({
      name: z.string().trim().min(1, "Enter the consignee name").max(200),
      address: optional("Consignee address", 500),
      gstin: optional("Consignee GSTIN", 15).refine((v) => v === null || GSTIN_PATTERN.test(v.toUpperCase()), "Enter a valid 15-character GSTIN, or leave it empty"),
      stateCode: z.string().trim().refine((v) => getStateByCode(v) !== undefined, "Choose the consignee's state"),
    })
    .nullish(),
  modeTermsOfPayment: optional("Mode/terms of payment", 200),
  referenceNoDate: optional("Reference no. & date", 200),
  otherReferences: optional("Other references", 200),
  dispatchDocNo: optional("Dispatch doc no.", 100),
  dispatchedThrough: optional("Dispatched through", 200),
  destination: optional("Destination", 200),
  termsOfDelivery: optional("Terms of delivery", 300),
  vehicleNo: optional("Vehicle number", 40),
  driverName: optional("Driver name", 100),
  driverPhone: optional("Driver phone", 30),
  showPrices: z.boolean().default(false),
  /** Owner only, and only needed when a quantity is above what is pending. */
  overrideReason: optional("Override reason", 500),
  lines: z.array(challanLineSchema).min(1, "Enter a quantity for at least one item").max(200, "At most 200 lines"),
});

export type ChallanInput = z.input<typeof challanSchema>;
export type ParsedChallan = z.output<typeof challanSchema>;

function firstProblem(error: z.ZodError): ValidationError {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  const first = error.issues[0];
  const lineIndex = first.path[0] === "lines" && typeof first.path[1] === "number" ? first.path[1] + 1 : null;
  return new ValidationError(lineIndex ? `Line ${lineIndex}: ${first.message}` : first.message, fieldErrors);
}

/** Validates a challan payload; the message is the first problem in words. */
export function parseChallan(input: unknown): ParsedChallan {
  const result = challanSchema.safeParse(input);
  if (result.success) return result.data;
  throw firstProblem(result.error);
}

export const cancelChallanSchema = z.object({
  id: z.uuid("That challan could not be found"),
  reason: z.string().trim().min(3, "Give a reason for cancelling the challan").max(500, "The reason is too long (at most 500 characters)"),
});

export function parseCancelChallan(input: unknown): z.output<typeof cancelChallanSchema> {
  const result = cancelChallanSchema.safeParse(input);
  if (result.success) return result.data;
  throw firstProblem(result.error);
}
