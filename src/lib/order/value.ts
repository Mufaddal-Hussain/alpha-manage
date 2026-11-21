import type Decimal from "decimal.js";
import type { TaxMode } from "@/lib/gst";
import { add, formatMoney } from "@/lib/money";
import { computeQuotation } from "@/lib/quotation/calc";

export interface OrderValueLine {
  /** In the line's unit. */
  quantity: string;
  rate: string;
  discountPercent: string;
  gstRate: string;
}

export interface OrderValue {
  taxable: string;
  tax: string;
  /** Taxable value plus GST, not rounded to the rupee: this is an estimate of what the ordered goods are worth, not a document total. */
  total: string;
}

const ZERO: OrderValue = { taxable: "0.00", tax: "0.00", total: "0.00" };

/** Value of ordered goods with the same line maths as quotations (exact decimals, GST split by tax mode). */
export function orderValue(lines: OrderValueLine[], mode: TaxMode): OrderValue {
  if (lines.length === 0) return ZERO;
  const totals = computeQuotation(
    lines.map((l) => ({ kind: "product" as const, quantity: l.quantity, rate: l.rate, discountPercent: l.discountPercent, gstRate: l.gstRate })),
    mode,
  );
  const tax: Decimal = add(totals.cgstTotal, totals.sgstTotal, totals.igstTotal);
  return { taxable: formatMoney(totals.taxableTotal), tax: formatMoney(tax), total: formatMoney(add(totals.taxableTotal, tax)) };
}
