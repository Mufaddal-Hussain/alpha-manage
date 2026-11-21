import { z } from "zod";
import { ValidationError } from "@/lib/errors";

// Validation for what the "Record PO" form submits (contracts/http-endpoints.md `recordPurchaseOrder`).
// Shared by the server and tests; no database or framework imports.

/** A decimal typed as text or number, kept as text so no float ever touches a quantity or an amount. */
const decimalText = (label: string, fractionDigits: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => new RegExp(`^\\d+(\\.\\d{1,${fractionDigits}})?$`).test(v), `${label} must be a number${fractionDigits === 0 ? "" : ` with at most ${fractionDigits} decimals`}`);

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date`)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), `${label} must be a real date`);

export const poLineSchema = z.object({
  quotationLineId: z.uuid("That item is not on this quotation"),
  /** In the line's unit; a whole number of boxes for box items (checked against the quotation line by the server). */
  quantity: decimalText("Quantity", 3).refine((v) => Number(v) > 0, "Quantity must be more than zero"),
});

export const purchaseOrderSchema = z.object({
  quotationId: z.uuid("That quotation could not be found"),
  customerPoNumber: z
    .string()
    .trim()
    .min(1, "Enter the customer's PO number")
    .max(60, "The PO number is too long (at most 60 characters)"),
  poDate: isoDate("PO date"),
  advanceReceived: decimalText("Advance received", 2).default("0"),
  notes: z
    .string()
    .trim()
    .max(2000, "At most 2000 characters")
    .nullish()
    .transform((v) => (v ? v : null)),
  lines: z.array(poLineSchema).min(1, "A PO needs at least one ordered item").max(200, "At most 200 lines"),
  fileIds: z
    .array(z.uuid("An attachment could not be found"))
    .max(10, "At most 10 attachments")
    .default([]),
  /** Staff confirmed that the same customer PO number already exists and the new one is meant. */
  confirmDuplicate: z.boolean().default(false),
});

export type PurchaseOrderInput = z.input<typeof purchaseOrderSchema>;
export type ParsedPurchaseOrder = z.output<typeof purchaseOrderSchema>;

/** Validates a PO payload; the message is the first problem in words (with the line number for line errors). */
export function parsePurchaseOrder(input: unknown): ParsedPurchaseOrder {
  const result = purchaseOrderSchema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  const first = result.error.issues[0];
  const lineIndex = first.path[0] === "lines" && typeof first.path[1] === "number" ? first.path[1] + 1 : null;
  throw new ValidationError(lineIndex ? `Line ${lineIndex}: ${first.message}` : first.message, fieldErrors);
}
