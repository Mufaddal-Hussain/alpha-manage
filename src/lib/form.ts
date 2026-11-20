import { z } from "zod";
import { ValidationError } from "@/lib/errors";

/** Plain text fields of a submitted form (file inputs are read separately from the FormData). */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) values[key] = value;
  }
  return values;
}

/** Validates form values with a zod schema; failures become a ValidationError with per-field messages. */
export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): z.output<S> {
  const result = schema.safeParse(formValues(formData));
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  throw new ValidationError("Please fix the highlighted fields", fieldErrors);
}

/** Optional text field: trims, enforces a max length, and turns empty into null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((value) => (value === "" ? null : value));
