import { dec, round2 } from "@/lib/money";

// Validation rules for the Excel/CSV price-list template (contracts/price-list-import.md). Pure functions: no
// database, no framework, no file access, so every rule is unit-testable and the review screen can re-run them
// after someone fixes a row. Money arithmetic goes through the shared exact-decimal helpers (never floats).

/** Template columns in order. `required` ones must exist in the header row of every file. */
export const TEMPLATE_COLUMNS = [
  "brand",
  "list_label",
  "effective_from",
  "size",
  "pieces_per_box",
  "sqft_per_box",
  "finish",
  "rate_per_box",
  "rate_per_sqft",
  "designs",
  "hsn_code",
] as const;

export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];

export const REQUIRED_COLUMNS: readonly TemplateColumn[] = [
  "brand",
  "effective_from",
  "size",
  "pieces_per_box",
  "sqft_per_box",
  "finish",
  "rate_per_box",
  "designs",
];

/** Largest gap, in rupees, allowed between the stated rate per sq.ft and rate per box ÷ sq.ft per box. */
export const SQFT_RATE_TOLERANCE = 1;

/** The text of one spreadsheet row, keyed by canonical column name. Missing cells are empty strings. */
export interface RawRow {
  /** Row number in the source file (the header is row 1), shown to people when something is wrong. */
  rowNumber: number;
  cells: Partial<Record<TemplateColumn, string>>;
}

/** A validated price row: one price of one group, with every design that shares it. */
export interface PriceRow {
  brand: string;
  listLabel: string | null;
  /** ISO date (the "w.e.f." date). */
  effectiveFrom: string;
  /** Normalised label, e.g. "600 x 600". */
  size: string;
  lengthMm: number | null;
  widthMm: number | null;
  piecesPerBox: number;
  /** Decimal string, 2 to 3 places. */
  sqftPerBox: string;
  finish: string;
  /** Decimal strings with 2 places, ex-GST. */
  ratePerBox: string;
  ratePerSqft: string;
  designs: string[];
  hsnCode: string | null;
}

export interface RowResult {
  rowNumber: number;
  /** Null when the row has errors; it can then not be accepted until fixed. */
  row: PriceRow | null;
  errors: string[];
  warnings: string[];
}

/** Lower-cases a header and turns spaces and dashes into underscores ("Rate per Box" -> "rate_per_box"). */
export function canonicalColumn(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Problems with the header row as a whole: required columns that are absent. Empty when the file can be read. */
export function checkHeaders(headers: readonly string[]): string[] {
  const present = new Set(headers.map(canonicalColumn));
  const missing = REQUIRED_COLUMNS.filter((c) => !present.has(c));
  if (missing.length === 0) return [];
  return [`The header row is missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the expected columns.`];
}

/** Lower-cased, single-spaced key used to compare design, size and brand names. */
export function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function tidy(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Splits the `designs` cell on `;`, trims, drops blanks and collapses repeats (case-insensitive). */
export function splitDesigns(cell: string): { designs: string[]; collapsed: string[] } {
  const designs: string[] = [];
  const seen = new Set<string>();
  const collapsed: string[] = [];
  for (const part of cell.split(";")) {
    const name = tidy(part);
    if (name === "") continue;
    const key = nameKey(name);
    if (seen.has(key)) {
      if (!collapsed.some((c) => nameKey(c) === key)) collapsed.push(designs.find((d) => nameKey(d) === key) ?? name);
      continue;
    }
    seen.add(key);
    designs.push(name);
  }
  return { designs, collapsed };
}

/** `600 x 600`, `1200X195`, `600mm × 1200 mm` -> normalised label and millimetres; anything else is kept as typed. */
export function parseSize(text: string): { label: string; lengthMm: number | null; widthMm: number | null } {
  const label = tidy(text);
  const match = /^(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?$/i.exec(label);
  if (!match) return { label, lengthMm: null, widthMm: null };
  const length = Number(match[1]);
  const width = Number(match[2]);
  return { label: `${match[1]} x ${match[2]}`, lengthMm: Math.round(length), widthMm: Math.round(width) };
}

const NUMBER = /^\d+(\.\d+)?$/;

function isIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function sqftText(value: string): string {
  const d = dec(value).toDecimalPlaces(3);
  return d.toFixed(d.decimalPlaces() > 2 ? 3 : 2);
}

/** Validates one row on its own (everything except rules that compare rows). */
function validateRow(raw: RawRow): RowResult {
  const cell = (c: TemplateColumn) => tidy(raw.cells[c] ?? "");
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const column of REQUIRED_COLUMNS) {
    if (cell(column) === "") errors.push(`${column} is required`);
  }

  const brand = cell("brand");
  const finish = cell("finish");
  const sizeText = cell("size");
  const listLabel = cell("list_label") || null;
  const hsnCode = cell("hsn_code") || null;

  const effectiveFrom = cell("effective_from");
  if (effectiveFrom !== "" && !isIsoDate(effectiveFrom)) {
    errors.push(`effective_from "${effectiveFrom}" is not a date; use YYYY-MM-DD, for example 2026-08-01`);
  }

  let piecesPerBox = 0;
  const pcs = cell("pieces_per_box");
  if (pcs !== "") {
    if (!/^\d+$/.test(pcs) || Number(pcs) < 1 || Number(pcs) > 9999) errors.push(`pieces_per_box "${pcs}" must be a whole number of tiles, at least 1`);
    else piecesPerBox = Number(pcs);
  }

  let sqftPerBox: string | null = null;
  const sqft = cell("sqft_per_box");
  if (sqft !== "") {
    if (!NUMBER.test(sqft) || dec(sqft).lte(0)) errors.push(`sqft_per_box "${sqft}" must be a number above zero, such as 15.50`);
    else sqftPerBox = sqftText(sqft);
  }

  let ratePerBox: string | null = null;
  const boxText = cell("rate_per_box");
  if (boxText !== "") {
    if (!NUMBER.test(boxText) || dec(boxText).lte(0)) errors.push(`rate_per_box "${boxText}" must be a number above zero, such as 883.50`);
    else ratePerBox = round2(boxText).toFixed(2);
  }

  let ratePerSqft: string | null = null;
  const sqftRateText = cell("rate_per_sqft");
  if (sqftRateText !== "" && !NUMBER.test(sqftRateText)) {
    errors.push(`rate_per_sqft "${sqftRateText}" must be a number, such as 57.00 (or leave it blank)`);
  } else if (ratePerBox !== null && sqftPerBox !== null) {
    const computed = round2(dec(ratePerBox).div(sqftPerBox));
    if (sqftRateText === "") {
      ratePerSqft = computed.toFixed(2);
    } else if (dec(sqftRateText).minus(dec(ratePerBox).div(sqftPerBox)).abs().gt(SQFT_RATE_TOLERANCE)) {
      errors.push(
        `rate per sq.ft ${round2(sqftRateText).toFixed(2)} does not match rate per box ${ratePerBox} ÷ ${sqftPerBox} sq.ft per box = ${computed.toFixed(2)} (allowed difference ₹${SQFT_RATE_TOLERANCE})`,
      );
    } else {
      ratePerSqft = round2(sqftRateText).toFixed(2); // the published value is kept as given
    }
  }

  const { designs, collapsed } = splitDesigns(raw.cells.designs ?? "");
  if (collapsed.length > 0) warnings.push(`Repeated in this row and counted once: ${collapsed.join(", ")}`);

  const size = parseSize(sizeText);
  if (sizeText !== "" && size.lengthMm === null) warnings.push(`Size "${size.label}" is not in the form 600 x 600, so length and width are not recorded`);

  if (errors.length > 0 || ratePerBox === null || ratePerSqft === null || sqftPerBox === null) {
    return { rowNumber: raw.rowNumber, row: null, errors, warnings };
  }
  return {
    rowNumber: raw.rowNumber,
    errors,
    warnings,
    row: {
      brand,
      listLabel,
      effectiveFrom,
      size: size.label,
      lengthMm: size.lengthMm,
      widthMm: size.widthMm,
      piecesPerBox,
      sqftPerBox,
      finish,
      ratePerBox,
      ratePerSqft,
      designs,
      hsnCode,
    },
  };
}

/**
 * Validates every row of a file and then the rules that compare rows:
 *  - all rows of one brand share one effective date and list label (the first valid row sets them);
 *  - a design name appears at most once per brand + size + finish (the later row is the one reported). The finish is
 *    part of the key because real lists repeat a design under two finishes (Bi'mor 1200 x 600 prints Calico Crema
 *    Endless under both Glossy and Carving), and the diff matches on (size, finish, design) too.
 * Every input row produces a result, so nothing unreadable is silently skipped (SC-003).
 */
export function validatePriceRows(rows: readonly RawRow[]): RowResult[] {
  const results = rows.map(validateRow);

  const listOfBrand = new Map<string, { effectiveFrom: string; listLabel: string | null; rowNumber: number }>();
  const designSeen = new Map<string, number>();

  for (const result of results) {
    const row = result.row;
    if (!row) continue;
    const brandKey = nameKey(row.brand);

    const list = listOfBrand.get(brandKey);
    const problems: string[] = [];
    if (!list) {
      listOfBrand.set(brandKey, { effectiveFrom: row.effectiveFrom, listLabel: row.listLabel, rowNumber: result.rowNumber });
    } else {
      if (list.effectiveFrom !== row.effectiveFrom) {
        problems.push(`effective_from ${row.effectiveFrom} differs from ${list.effectiveFrom} in row ${list.rowNumber}; one file holds one list per brand`);
      }
      if ((list.listLabel ?? "") !== (row.listLabel ?? "")) {
        problems.push(`list_label "${row.listLabel ?? ""}" differs from "${list.listLabel ?? ""}" in row ${list.rowNumber}`);
      }
    }

    const repeated: string[] = [];
    const claimed: string[] = [];
    for (const design of row.designs) {
      const key = `${brandKey}|${nameKey(row.size)}|${nameKey(row.finish)}|${nameKey(design)}`;
      const first = designSeen.get(key);
      if (first !== undefined) repeated.push(`${design} (first in row ${first})`);
      else claimed.push(key);
    }
    if (repeated.length > 0) {
      problems.push(`Design appears more than once for ${row.brand} ${row.size} ${row.finish}: ${repeated.join(", ")}`);
    }

    if (problems.length > 0) {
      result.errors.push(...problems);
      result.row = null;
    } else {
      for (const key of claimed) designSeen.set(key, result.rowNumber);
    }
  }
  return results;
}
