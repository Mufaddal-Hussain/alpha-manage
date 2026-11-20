import { z } from "zod";
import { optionalText } from "@/lib/form";
import { GSTIN_FORMAT_MESSAGE, GSTIN_STATE_MESSAGE, GSTIN_PATTERN, gstinStateCode, normaliseGstin } from "@/lib/gstin";
import { getStateByCode } from "@/lib/gst/state-codes";

// Validation for the customer master (FR-004, FR-005; data-model.md "customer"). Shared by the
// server actions and by tests; it has no database or framework imports.

const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;

const email = optionalText(120).refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email");
const phone = optionalText(30).refine((v) => v === null || /^[0-9+()\-\s]{6,30}$/.test(v), "Enter a valid phone number");
const pincode = optionalText(6).refine((v) => v === null || /^\d{6}$/.test(v), "Pincode must be 6 digits");

export const customerSchema = z
  .object({
    type: z.enum(["individual", "company"], "Choose individual or company"),
    displayName: z.string().trim().min(1, "Required").max(120),
    legalName: optionalText(160),
    gstin: z.string().transform((v) => normaliseGstin(v)),
    pan: optionalText(10).transform((v) => v?.toUpperCase() ?? null),
    /** Blank means "take it from the GSTIN". */
    stateCode: z.string().trim(),
    addressLine1: optionalText(160),
    addressLine2: optionalText(160),
    city: optionalText(80),
    pincode,
    phone,
    email,
    notes: optionalText(1000),
  })
  .transform((value, ctx) => {
    let stateCode = value.stateCode;
    if (value.gstin !== null) {
      if (!GSTIN_PATTERN.test(value.gstin)) {
        ctx.addIssue({ code: "custom", path: ["gstin"], message: GSTIN_FORMAT_MESSAGE });
        return z.NEVER;
      }
      const fromGstin = gstinStateCode(value.gstin);
      if (stateCode === "") stateCode = fromGstin;
      else if (stateCode !== fromGstin) {
        ctx.addIssue({ code: "custom", path: ["gstin"], message: GSTIN_STATE_MESSAGE });
        return z.NEVER;
      }
    }
    if (stateCode === "") {
      ctx.addIssue({ code: "custom", path: ["stateCode"], message: "Choose a state" });
      return z.NEVER;
    }
    if (!getStateByCode(stateCode)) {
      ctx.addIssue({ code: "custom", path: ["stateCode"], message: value.gstin ? "The GSTIN starts with an unknown state code" : "Choose a state" });
      return z.NEVER;
    }
    if (value.pan !== null) {
      if (!PAN_PATTERN.test(value.pan)) {
        ctx.addIssue({ code: "custom", path: ["pan"], message: "PAN must look like ABCDE1234F" });
        return z.NEVER;
      }
      if (value.gstin !== null && value.gstin.slice(2, 12) !== value.pan) {
        ctx.addIssue({ code: "custom", path: ["pan"], message: "PAN does not match the GSTIN (characters 3 to 12 of a GSTIN are the PAN)" });
        return z.NEVER;
      }
    }
    return { ...value, stateCode };
  });

export type CustomerInput = z.output<typeof customerSchema>;

const stateCode = z
  .string()
  .trim()
  .refine((v) => getStateByCode(v) !== undefined, "Choose a state");

export const customerAddressSchema = z.object({
  id: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.uuid().nullable()),
  label: z.string().trim().min(1, "Required").max(80),
  addressLine1: z.string().trim().min(1, "Required").max(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  pincode,
  stateCode,
  isDefaultShipping: z.string().optional(),
});

export const customerContactSchema = z.object({
  id: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.uuid().nullable()),
  name: z.string().trim().min(1, "Required").max(120),
  phone,
  email,
  role: optionalText(80),
});
