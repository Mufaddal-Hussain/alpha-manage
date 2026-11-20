/**
 * GSTIN rules (data-model.md, "Validation rules"): 15 characters in the standard pattern, and the
 * first two digits equal the party's GST state code. The checksum character is not verified.
 */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const GSTIN_FORMAT_MESSAGE = "GSTIN must be 15 characters in the standard format, for example 27ABYFA7430K1ZT";
export const GSTIN_STATE_MESSAGE = "The first two digits of the GSTIN must match the state";

/** Trims and upper-cases a typed GSTIN; blank input means "no GSTIN" (null). */
export function normaliseGstin(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** The state code a GSTIN carries: its first two characters. */
export function gstinStateCode(gstin: string): string {
  return gstin.slice(0, 2);
}

/**
 * Returns an error message, or null when the GSTIN is acceptable. A missing GSTIN is fine
 * (it is optional for individuals). Format is checked before the state match.
 */
export function validateGstin(gstin: string | null | undefined, stateCode: string): string | null {
  const value = normaliseGstin(gstin);
  if (value === null) return null;
  if (!GSTIN_PATTERN.test(value)) return GSTIN_FORMAT_MESSAGE;
  if (gstinStateCode(value) !== stateCode) return GSTIN_STATE_MESSAGE;
  return null;
}
