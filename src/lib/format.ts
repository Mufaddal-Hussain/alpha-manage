// Display formatting shared by pages and PDFs. Money arrives as NUMERIC text ("3387.00"); only Intl formats it.

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const QTY = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

/** 3387 -> "3,387.00" (Indian digit grouping, no symbol). */
export function formatInr(value: string | number): string {
  return INR.format(Number(value));
}

/** "₹ 3,387.00" */
export function formatRupees(value: string | number): string {
  return `₹ ${formatInr(value)}`;
}

/** "4.000" -> "4", "37.500" -> "37.5" */
export function formatQuantity(value: string | number): string {
  return QTY.format(Number(value));
}

/** 2026-11-21 -> "21 Nov 2026" */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export const UNIT_LABELS = { box: "Box", sqft: "Sq.ft", piece: "Nos" } as const;
