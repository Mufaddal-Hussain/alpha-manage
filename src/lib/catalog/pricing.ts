import { dec, round2, type MoneyInput } from "@/lib/money";

// Cost, selling price and margin for catalog products. Margin is a markup on cost, as FR-009 words it
// ("a margin on the cost price"): margin % = (selling - cost) / cost x 100, and selling = cost x (1 + margin / 100).
// Exact decimal arithmetic throughout; results are 2 dp strings ready for NUMERIC columns.

type Blank = MoneyInput | null | undefined;

const present = (v: Blank): v is MoneyInput => v !== null && v !== undefined && String(v).trim() !== "";

/** Margin on cost in percent, or null when there is no (non-zero) cost or no price. */
export function marginFromPrice(cost: Blank, price: Blank): string | null {
  if (!present(cost) || !present(price) || dec(cost).lte(0)) return null;
  return round2(dec(price).minus(cost).div(cost).times(100)).toFixed(2);
}

/** Selling price that gives `margin` percent over `cost`. Requires a cost. */
export function priceFromMargin(cost: MoneyInput, margin: MoneyInput): string {
  return round2(dec(cost).times(dec(100).plus(margin)).div(100)).toFixed(2);
}

/** The distributor cost expressed per the product's selling unit. */
export function costForUnit(unit: "box" | "sqft" | "piece", group: { ratePerBox: MoneyInput; ratePerSqft: MoneyInput; piecesPerBox: number }): string {
  if (unit === "sqft") return round2(group.ratePerSqft).toFixed(2);
  if (unit === "piece") return round2(dec(group.ratePerBox).div(group.piecesPerBox)).toFixed(2);
  return round2(group.ratePerBox).toFixed(2);
}

export interface SellingInput {
  cost: Blank;
  currentPrice: Blank;
  currentMargin: Blank;
  /** What the form (or caller) now says. A blank price means "no selling price". */
  price: Blank;
  margin: Blank;
}

/**
 * Keeps price and margin consistent. The one that the person changed wins: a price different from the stored one
 * sets the margin; otherwise a margin different from the stored one sets the price. Without a cost there is no
 * margin to keep.
 */
export function resolveSelling(input: SellingInput): { price: string | null; margin: string | null } {
  const sameNumber = (a: Blank, b: Blank) => (present(a) && present(b) ? dec(a).eq(b) : !present(a) && !present(b));
  const priceChanged = !sameNumber(input.price, input.currentPrice);
  const marginChanged = present(input.margin) && !sameNumber(input.margin, input.currentMargin);
  const hasCost = present(input.cost) && dec(input.cost).gt(0);

  if (!priceChanged && marginChanged && hasCost) {
    const price = priceFromMargin(input.cost as MoneyInput, input.margin as MoneyInput);
    return { price, margin: marginFromPrice(input.cost, price) };
  }
  if (!present(input.price)) {
    // A margin typed against a product that has a cost but no price yet sets the price.
    if (marginChanged && hasCost) {
      const price = priceFromMargin(input.cost as MoneyInput, input.margin as MoneyInput);
      return { price, margin: marginFromPrice(input.cost, price) };
    }
    return { price: null, margin: null };
  }
  const price = round2(input.price).toFixed(2);
  return { price, margin: marginFromPrice(input.cost, price) };
}
