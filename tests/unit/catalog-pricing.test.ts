import { describe, expect, it } from "vitest";
import { costForUnit, marginFromPrice, priceFromMargin, resolveSelling } from "@/lib/catalog/pricing";

describe("margin on cost", () => {
  it("derives margin from price: cost 883.50, price 1000 -> 13.19%", () => {
    expect(marginFromPrice("883.50", "1000")).toBe("13.19");
  });
  it("derives price from margin: cost 883.50 at 20% -> 1060.20", () => {
    expect(priceFromMargin("883.50", "20")).toBe("1060.20");
  });
  it("round-trips a whole-number margin", () => {
    expect(marginFromPrice("800", priceFromMargin("800", "25"))).toBe("25.00");
  });
  it("has no margin without a cost or a price", () => {
    expect(marginFromPrice(null, "100")).toBeNull();
    expect(marginFromPrice("0", "100")).toBeNull();
    expect(marginFromPrice("100", null)).toBeNull();
  });
  it("allows a negative margin (selling below cost)", () => {
    expect(marginFromPrice("100", "90")).toBe("-10.00");
  });
});

describe("cost per unit", () => {
  const g = { ratePerBox: "883.50", ratePerSqft: "57.00", piecesPerBox: 4 };
  it("is the rate per box for box products, per sq.ft for sq.ft products, and per tile for pieces", () => {
    expect(costForUnit("box", g)).toBe("883.50");
    expect(costForUnit("sqft", g)).toBe("57.00");
    expect(costForUnit("piece", g)).toBe("220.88");
  });
});

describe("resolveSelling", () => {
  const base = { cost: "800.00", currentPrice: "900.00", currentMargin: "12.50" };
  it("a changed price wins and gives the margin", () => {
    expect(resolveSelling({ ...base, price: "1000", margin: "12.50" })).toEqual({ price: "1000.00", margin: "25.00" });
  });
  it("a changed margin gives the price when the price is untouched", () => {
    expect(resolveSelling({ ...base, price: "900.00", margin: "30" })).toEqual({ price: "1040.00", margin: "30.00" });
  });
  it("nothing changed keeps both", () => {
    expect(resolveSelling({ ...base, price: "900", margin: "12.50" })).toEqual({ price: "900.00", margin: "12.50" });
  });
  it("blank price clears both", () => {
    expect(resolveSelling({ ...base, price: "", margin: "" })).toEqual({ price: null, margin: null });
  });
  it("a margin alone with no price sets the price", () => {
    expect(resolveSelling({ cost: "800", currentPrice: null, currentMargin: null, price: null, margin: "10" })).toEqual({ price: "880.00", margin: "10.00" });
  });
  it("without a cost the margin stays empty", () => {
    expect(resolveSelling({ cost: null, currentPrice: null, currentMargin: null, price: "500", margin: null })).toEqual({ price: "500.00", margin: null });
  });
});
