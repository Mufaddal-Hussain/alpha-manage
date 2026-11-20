import { sql } from "drizzle-orm";
import type { Database } from "@/db";
import type { NumberSeriesKind } from "@/db/schema";
import { financialYearOf } from "@/lib/financial-year";

/** Anything that can run SQL: the database client or, normally, the caller's transaction. */
type Executor = Pick<Database, "execute">;

/** Format used when a series has no row yet (settings can change it afterwards). */
export const DEFAULT_FORMATS: Record<NumberSeriesKind, string> = {
  quotation: "QT/{FY}/{N:4}",
  challan: "CH/{FY}/{N:4}",
  invoice: "INV/{FY}/{N:4}",
  receipt: "RC/{FY}/{N:4}",
};

const PLACEHOLDER = /\{([^{}]*)\}/g;
const MAX_FORMAT_LENGTH = 40;

/** `QT/{FY}/{N:4}` + `2026-27` + 3 -> `QT/2026-27/0003`. `{N}` is unpadded, `{N:w}` pads to width w. */
export function formatNumber(format: string, financialYear: string, value: number): string {
  return format.replace(PLACEHOLDER, (match, token: string) => {
    if (token === "FY") return financialYear;
    if (token === "N") return String(value);
    const padded = /^N:(\d{1,2})$/.exec(token);
    if (padded) return String(value).padStart(Number(padded[1]), "0");
    return match;
  });
}

/** Returns an error message for an unusable format, or null when it is fine. */
export function validateFormat(format: string): string | null {
  if (format.length === 0 || format.length > MAX_FORMAT_LENGTH) {
    return `Format must be 1 to ${MAX_FORMAT_LENGTH} characters long`;
  }
  const tokens = [...format.matchAll(PLACEHOLDER)].map((m) => m[1]);
  for (const token of tokens) {
    if (token === "FY" || token === "N") continue;
    const padded = /^N:(\d+)$/.exec(token);
    if (padded) {
      if (Number(padded[1]) < 1 || Number(padded[1]) > 8) return "{N:width} width must be between 1 and 8";
      continue;
    }
    return `Unknown placeholder {${token}}; use {FY} and {N} (or {N:4} for zero padding)`;
  }
  if (!tokens.some((t) => t === "N" || t.startsWith("N:"))) return "Format must contain {N} (the running number)";
  if (!tokens.includes("FY")) {
    return "Format must contain {FY} (the financial year), because numbers restart every year and would otherwise repeat";
  }
  return null;
}

export interface IssuedNumber {
  /** Display number, e.g. `QT/2026-27/0001`. */
  number: string;
  /** The running value within the financial year. */
  value: number;
  financialYear: string;
}

/**
 * Takes the next number of a series for the financial year of `date`.
 *
 * Run it inside the transaction that inserts the document: the row lock taken by the
 * upsert is held until that transaction ends, so concurrent callers queue up and each
 * gets the next value, and a rollback gives the number back (gap-free, R8).
 * A new financial year gets its own row, starting at 1 and keeping the latest format.
 */
export async function nextNumber(tx: Executor, series: NumberSeriesKind, date: Date): Promise<IssuedNumber> {
  const financialYear = financialYearOf(date);
  const result = await tx.execute<{ last_value: number; format: string }>(sql`
    INSERT INTO number_series (series, financial_year, format, last_value)
    VALUES (
      ${series}::number_series_kind,
      ${financialYear},
      COALESCE(
        (SELECT format FROM number_series WHERE series = ${series}::number_series_kind ORDER BY financial_year DESC LIMIT 1),
        ${DEFAULT_FORMATS[series]}
      ),
      1
    )
    ON CONFLICT (series, financial_year)
    DO UPDATE SET last_value = number_series.last_value + 1, updated_at = now()
    RETURNING last_value, format
  `);
  const row = result.rows[0];
  return { number: formatNumber(row.format, financialYear, row.last_value), value: row.last_value, financialYear };
}
