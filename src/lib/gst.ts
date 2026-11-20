import type Decimal from "decimal.js";
import { add, dec, mul, round2, roundOff, type MoneyInput } from "@/lib/money";

export type TaxMode = "intra" | "inter";

/** Same state as the business -> CGST + SGST; a different state -> IGST. */
export function taxMode(placeOfSupplyStateCode: string, businessStateCode: string): TaxMode {
  return placeOfSupplyStateCode === businessStateCode ? "intra" : "inter";
}

export interface TaxSplit {
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  total: Decimal;
}

/** Tax on a taxable value. `gstRate` is the full percentage (18 = 18%); intra-state halves it for CGST and SGST. */
export function splitTax(taxableValue: MoneyInput, gstRate: MoneyInput, mode: TaxMode): TaxSplit {
  const zero = dec(0);
  if (mode === "inter") {
    const igst = round2(mul(taxableValue, gstRate).div(100));
    return { cgst: zero, sgst: zero, igst, total: igst };
  }
  const half = round2(mul(taxableValue, gstRate).div(200));
  return { cgst: half, sgst: half, igst: zero, total: add(half, half) };
}

export interface LineInput {
  quantity: MoneyInput;
  rate: MoneyInput;
  discountPercent: MoneyInput;
  gstRate: MoneyInput;
}

export interface LineResult extends TaxSplit {
  taxableValue: Decimal;
  lineTotal: Decimal;
}

/** Taxable value = quantity x rate less discount, rounded to 2 dp; tax is then computed on that value. */
export function computeLine(line: LineInput, mode: TaxMode): LineResult {
  const gross = mul(line.quantity, line.rate);
  const taxableValue = round2(gross.minus(gross.times(line.discountPercent).div(100)));
  const tax = splitTax(taxableValue, line.gstRate, mode);
  return { ...tax, taxableValue, lineTotal: add(taxableValue, tax.total) };
}

export interface DocumentTotals {
  lines: LineResult[];
  taxableTotal: Decimal;
  cgstTotal: Decimal;
  sgstTotal: Decimal;
  igstTotal: Decimal;
  roundOff: Decimal;
  grandTotal: Decimal;
}

/** Sums per-line results, then rounds the document total to the nearest rupee as a separate round-off line. */
export function computeDocumentTotals(lines: LineInput[], mode: TaxMode): DocumentTotals {
  const results = lines.map((line) => computeLine(line, mode));
  const taxableTotal = add(...results.map((l) => l.taxableValue));
  const cgstTotal = add(...results.map((l) => l.cgst));
  const sgstTotal = add(...results.map((l) => l.sgst));
  const igstTotal = add(...results.map((l) => l.igst));
  const exactTotal = add(taxableTotal, cgstTotal, sgstTotal, igstTotal);
  const rounded = roundOff(exactTotal);
  return {
    lines: results,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    roundOff: rounded.roundOff,
    grandTotal: rounded.rounded,
  };
}
