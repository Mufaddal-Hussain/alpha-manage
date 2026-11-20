import { z } from "zod";
import { optionalText } from "@/lib/form";

// Validation for manual product entry (T042; FR-008a, FR-008b, FR-011). No database or framework imports.

const decimal = (label: string, digits: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`).test(v), `${label} must be a number${digits ? ` with at most ${digits} decimals` : ""}`);

const productFields = z.object({
    name: z.string().trim().min(1, "Required").max(200),
    code: optionalText(60),
    sizeLabel: optionalText(60),
    finish: optionalText(60),
    unit: z.enum(["box", "sqft", "piece"], "Choose how it is sold"),
    piecesPerBox: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{1,4}$/.test(v), "Whole number of pieces")
      .transform((v) => (v === "" ? null : Number(v))),
    sqftPerBox: decimal("Sq.ft per box", 3).transform((v) => (v === "" ? null : v)),
    hsnCode: z.string().trim().min(1, "Required").max(12, "HSN codes have up to 8 digits"),
    gstRate: decimal("GST rate", 2)
      .refine((v) => v !== "", "Required")
      .refine((v) => Number(v) <= 100, "GST rate cannot be more than 100"),
    sellingPricePerUnit: decimal("Selling price", 2).transform((v) => (v === "" ? null : v)),
});

export const productSchema = productFields.superRefine((value, ctx) => {
    if (value.sqftPerBox !== null && Number(value.sqftPerBox) <= 0) {
      ctx.addIssue({ code: "custom", path: ["sqftPerBox"], message: "Sq.ft per box must be more than zero" });
    }
    if (value.unit === "box" && value.sqftPerBox === null) {
      ctx.addIssue({ code: "custom", path: ["sqftPerBox"], message: "A product sold by the box needs its sq.ft per box" });
    }
});

/** What sales staff may change on an existing product. */
export const sellingPriceSchema = productFields.pick({ sellingPricePerUnit: true });

export type ProductValues = z.output<typeof productSchema>;
