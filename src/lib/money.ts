import Decimal from "decimal.js";

// Isolated Decimal constructor: half-up rounding (Indian invoicing convention) without
// touching the global decimal.js configuration.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = Decimal.Value;

/** Parses a string, number or Decimal into an exact decimal. Never do money maths on JS floats. */
export function dec(value: MoneyInput): Decimal {
  return new D(value);
}

/** Exact sum, no rounding. */
export function add(...values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((sum, value) => sum.plus(value), dec(0));
}

/** Exact product, no rounding (round afterwards with round2). */
export function mul(a: MoneyInput, b: MoneyInput): Decimal {
  return dec(a).times(b);
}

/** Rounds to 2 decimal places, half-up. */
export function round2(value: MoneyInput): Decimal {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Rounds a document total to the nearest rupee (half-up) and returns the signed difference
 * as the round-off line: 3,386.60 -> rounded 3,387.00, roundOff +0.40.
 */
export function roundOff(total: MoneyInput): { rounded: Decimal; roundOff: Decimal } {
  const exact = round2(total);
  const rounded = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { rounded, roundOff: rounded.minus(exact) };
}

/** Plain 2 dp string ("3387.00"), the form NUMERIC(14,2) columns take. */
export function formatMoney(value: MoneyInput): string {
  return round2(value).toFixed(2);
}
