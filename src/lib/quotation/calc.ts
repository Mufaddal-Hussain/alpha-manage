import type Decimal from "decimal.js";
import { amountInWords } from "@/lib/amount-in-words";
import { computeDocumentTotals, type LineResult, type TaxMode } from "@/lib/gst";
import { add, dec, formatMoney, type MoneyInput } from "@/lib/money";

// The quotation calculation engine (T043): the box <-> sq.ft rules and the document maths for a quotation,
// built on the shared money and GST helpers. Pure functions: no database, no framework.

export type QuantityUnit = "box" | "sqft" | "piece";
export type EnteredIn = "box" | "sqft" | "piece";

/** Whole boxes needed to cover an area; part boxes round up (FR-012). */
export function boxesForSqft(sqft: MoneyInput, sqftPerBox: MoneyInput): Decimal {
  return dec(sqft).div(sqftPerBox).ceil();
}

/** Area covered by a number of boxes (exact). */
export function sqftForBoxes(boxes: MoneyInput, sqftPerBox: MoneyInput): Decimal {
  return dec(boxes).times(sqftPerBox);
}

export interface QuantityEntry {
  /** What the product is sold and priced in. */
  unit: QuantityUnit;
  /** The number the person typed. */
  entered: MoneyInput;
  /** The measure they typed it in. */
  enteredIn: EnteredIn;
  sqftPerBox: MoneyInput | null;
}

export interface ResolvedQuantity {
  /** In the product's own unit; this is what is priced and stored as the source of truth. */
  quantity: Decimal;
  /** The other measure, for display only: sq.ft for a box product, boxes for a sq.ft product. Null when unknown. */
  quantityAlt: Decimal | null;
}

/**
 * Turns what was typed (boxes or sq.ft) into the quantity in the product's unit plus the other measure shown
 * beside it. A box product is always a whole number of boxes: sq.ft rounds up, and a typed part box is refused.
 */
export function resolveQuantity({ unit, entered, enteredIn, sqftPerBox }: QuantityEntry): ResolvedQuantity {
  const typed = dec(entered);
  const packing = sqftPerBox === null || sqftPerBox === undefined || dec(sqftPerBox).lte(0) ? null : dec(sqftPerBox);

  if (unit === "piece") {
    if (enteredIn !== "piece") throw new RangeError("This item is sold by the piece; enter a number of pieces");
    return { quantity: typed, quantityAlt: null };
  }

  if (unit === "box") {
    if (enteredIn === "box") {
      if (!typed.isInteger()) throw new RangeError("Quantity must be a whole number of boxes");
      return { quantity: typed, quantityAlt: packing ? sqftForBoxes(typed, packing) : null };
    }
    if (!packing) throw new RangeError("This product has no packing (sq.ft per box), so a sq.ft quantity cannot be converted to boxes");
    const boxes = boxesForSqft(typed, packing);
    return { quantity: boxes, quantityAlt: sqftForBoxes(boxes, packing) };
  }

  // unit === "sqft"
  if (enteredIn === "sqft") {
    return { quantity: typed, quantityAlt: packing ? boxesForSqft(typed, packing) : null };
  }
  if (!packing) throw new RangeError("This product has no packing (sq.ft per box), so boxes cannot be converted to sq.ft");
  return { quantity: sqftForBoxes(typed, packing), quantityAlt: typed };
}

export interface QuoteLineInput {
  kind: "product" | "charge";
  /** In the line's unit; a charge line is quantity 1 at its amount. */
  quantity: MoneyInput;
  rate: MoneyInput;
  discountPercent: MoneyInput;
  /** Full percentage (18 = 18%). */
  gstRate: MoneyInput;
  hsnCode?: string;
}

export interface HsnSummaryRow {
  hsnCode: string;
  gstRate: string;
  taxableValue: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
}

export interface QuotationTotals {
  lines: LineResult[];
  taxableTotal: Decimal;
  cgstTotal: Decimal;
  sgstTotal: Decimal;
  igstTotal: Decimal;
  roundOff: Decimal;
  grandTotal: Decimal;
  totalInWords: string;
  advance: Decimal;
  balance: Decimal;
  /** Tax summary per HSN/SAC code and rate, in order of first appearance (products before charges). */
  hsnSummary: HsnSummaryRow[];
}

/** Validates one line; the same rules the server enforces on save (data-model.md "Validation rules"). */
function assertLine(line: QuoteLineInput, index: number): void {
  const label = `Line ${index + 1}`;
  if (dec(line.quantity).lte(0)) throw new RangeError(`${label}: quantity must be more than zero`);
  if (dec(line.rate).isNegative()) throw new RangeError(`${label}: rate cannot be negative`);
  const discount = dec(line.discountPercent);
  if (discount.isNegative() || discount.greaterThan(100)) throw new RangeError(`${label}: discount must be between 0 and 100`);
  const gst = dec(line.gstRate);
  if (gst.isNegative() || gst.greaterThan(100)) throw new RangeError(`${label}: GST rate must be between 0 and 100`);
}

/** Line amounts, GST split, round-off, grand total, words, advance/balance and the HSN summary for a quotation. */
export function computeQuotation(lines: QuoteLineInput[], mode: TaxMode, options: { advance?: MoneyInput } = {}): QuotationTotals {
  if (lines.length === 0) throw new RangeError("A quotation needs at least one line");
  lines.forEach(assertLine);

  const totals = computeDocumentTotals(lines, mode);

  const summary = new Map<string, HsnSummaryRow>();
  lines.forEach((line, i) => {
    const result = totals.lines[i];
    const hsnCode = line.hsnCode ?? "";
    const gstRate = dec(line.gstRate).toString();
    const key = `${hsnCode}|${gstRate}`;
    const row = summary.get(key) ?? { hsnCode, gstRate, taxableValue: dec(0), cgst: dec(0), sgst: dec(0), igst: dec(0) };
    row.taxableValue = add(row.taxableValue, result.taxableValue);
    row.cgst = add(row.cgst, result.cgst);
    row.sgst = add(row.sgst, result.sgst);
    row.igst = add(row.igst, result.igst);
    summary.set(key, row);
  });

  const advance = dec(formatMoney(options.advance ?? 0));
  return {
    lines: totals.lines,
    taxableTotal: totals.taxableTotal,
    cgstTotal: totals.cgstTotal,
    sgstTotal: totals.sgstTotal,
    igstTotal: totals.igstTotal,
    roundOff: totals.roundOff,
    grandTotal: totals.grandTotal,
    totalInWords: amountInWords(totals.grandTotal),
    advance,
    balance: totals.grandTotal.minus(advance),
    hsnSummary: [...summary.values()],
  };
}
