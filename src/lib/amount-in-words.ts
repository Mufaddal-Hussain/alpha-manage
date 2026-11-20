import { round2, type MoneyInput } from "@/lib/money";

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** Words for 1..99. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = ONES[n % 10];
  return ones ? `${tens} ${ones}` : tens;
}

/** Words for 1..999. */
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** Whole number in Indian grouping: crore (10^7), lakh (10^5), thousand, then the last three digits. */
function integerInWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const rest = n % 1_000;
  const parts: string[] = [];
  // Crores can exceed 99 (100 crore and above), so they use the three-digit helper.
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/** "INR Three Thousand Three Hundred Eighty Seven Only"; paise as "... and Fifty Six Paise Only". */
export function amountInWords(amount: MoneyInput): string {
  const value = round2(amount);
  if (value.isNegative()) throw new RangeError("Amount in words needs a non-negative amount");
  const rupees = value.trunc();
  if (rupees.greaterThan(Number.MAX_SAFE_INTEGER)) throw new RangeError("Amount is too large to write in words");
  const paise = value.minus(rupees).times(100).toNumber();
  const rupeeCount = rupees.toNumber();

  if (paise === 0) return `INR ${integerInWords(rupeeCount)} Only`;
  if (rupeeCount === 0) return `INR ${twoDigits(paise)} Paise Only`;
  return `INR ${integerInWords(rupeeCount)} and ${twoDigits(paise)} Paise Only`;
}
