import { describe, expect, it } from "vitest";
import {
  boxesForSqft,
  computeQuotation,
  resolveQuantity,
  sqftForBoxes,
  type QuoteLineInput,
} from "@/lib/quotation/calc";

// Radius 9 delivery note (samples/3 Radius 9.pdf, research R1): 4 box x 580.00 + Transport Charges 550.00,
// both at 18% (9% + 9%).
const tile: QuoteLineInput = { kind: "product", quantity: 4, rate: "580.00", discountPercent: 0, gstRate: 18, hsnCode: "6907" };
const transport: QuoteLineInput = { kind: "charge", quantity: 1, rate: "550.00", discountPercent: 0, gstRate: 18, hsnCode: "8704" };

describe("box <-> sq.ft conversion (FR-012)", () => {
  it("rounds sq.ft up to whole boxes", () => {
    expect(boxesForSqft(60, "15.50").toString()).toBe("4"); // 3.87 boxes -> 4
    expect(boxesForSqft(62, "15.50").toString()).toBe("4"); // exact
    expect(boxesForSqft("62.01", "15.50").toString()).toBe("5");
    expect(boxesForSqft("0.5", "15.50").toString()).toBe("1");
  });

  it("converts boxes to sq.ft exactly", () => {
    expect(sqftForBoxes(4, "15.50").toString()).toBe("62");
    expect(sqftForBoxes(3, "23.25").toString()).toBe("69.75");
  });

  it("box product entered in boxes: quantity is the boxes, alt is the sq.ft", () => {
    const r = resolveQuantity({ unit: "box", entered: 4, enteredIn: "box", sqftPerBox: "15.50" });
    expect(r.quantity.toString()).toBe("4");
    expect(r.quantityAlt?.toString()).toBe("62");
  });

  it("box product entered in sq.ft: rounds up to whole boxes and shows the sq.ft those boxes cover", () => {
    const r = resolveQuantity({ unit: "box", entered: 60, enteredIn: "sqft", sqftPerBox: "15.50" });
    expect(r.quantity.toString()).toBe("4");
    expect(r.quantityAlt?.toString()).toBe("62");
  });

  it("refuses a part box for a product sold by the box", () => {
    expect(() => resolveQuantity({ unit: "box", entered: "4.5", enteredIn: "box", sqftPerBox: "15.50" })).toThrow(/whole/i);
  });

  it("sq.ft product (granite, no packing) has no alternative quantity", () => {
    const r = resolveQuantity({ unit: "sqft", entered: "37.5", enteredIn: "sqft", sqftPerBox: null });
    expect(r.quantity.toString()).toBe("37.5");
    expect(r.quantityAlt).toBeNull();
  });

  it("sq.ft product with packing shows the boxes that cover the area", () => {
    const r = resolveQuantity({ unit: "sqft", entered: 60, enteredIn: "sqft", sqftPerBox: "15.50" });
    expect(r.quantity.toString()).toBe("60");
    expect(r.quantityAlt?.toString()).toBe("4");
  });

  it("entering boxes for a sq.ft product converts to sq.ft", () => {
    const r = resolveQuantity({ unit: "sqft", entered: 4, enteredIn: "box", sqftPerBox: "15.50" });
    expect(r.quantity.toString()).toBe("62");
    expect(r.quantityAlt?.toString()).toBe("4");
  });

  it("a conversion with no packing is an error, not a guess", () => {
    expect(() => resolveQuantity({ unit: "box", entered: 10, enteredIn: "sqft", sqftPerBox: null })).toThrow(/packing/i);
  });

  it("piece items need no packing", () => {
    const r = resolveQuantity({ unit: "piece", entered: 3, enteredIn: "piece", sqftPerBox: null });
    expect(r.quantity.toString()).toBe("3");
    expect(r.quantityAlt).toBeNull();
  });
});

describe("quotation totals", () => {
  it("reproduces the Radius 9 hand calculation intra-state", () => {
    const q = computeQuotation([tile, transport], "intra");
    expect(q.lines[0].taxableValue.toFixed(2)).toBe("2320.00");
    expect(q.lines[1].taxableValue.toFixed(2)).toBe("550.00");
    expect(q.taxableTotal.toFixed(2)).toBe("2870.00");
    expect(q.cgstTotal.toFixed(2)).toBe("258.30");
    expect(q.sgstTotal.toFixed(2)).toBe("258.30");
    expect(q.igstTotal.toFixed(2)).toBe("0.00");
    expect(q.roundOff.toFixed(2)).toBe("0.40");
    expect(q.grandTotal.toFixed(2)).toBe("3387.00");
    expect(q.totalInWords).toBe("INR Three Thousand Three Hundred Eighty Seven Only");
  });

  it("shows IGST 516.60 instead of CGST+SGST inter-state (quickstart scenario 1)", () => {
    const q = computeQuotation([tile, transport], "inter");
    expect(q.cgstTotal.toFixed(2)).toBe("0.00");
    expect(q.sgstTotal.toFixed(2)).toBe("0.00");
    expect(q.igstTotal.toFixed(2)).toBe("516.60");
    expect(q.roundOff.toFixed(2)).toBe("0.40");
    expect(q.grandTotal.toFixed(2)).toBe("3387.00");
  });

  it("applies a line discount before tax", () => {
    // 10 box x 883.50 = 8835.00 less 10% = 7951.50; 9% of that is 715.635 -> 715.64 each side (half-up)
    const q = computeQuotation([{ kind: "product", quantity: 10, rate: "883.50", discountPercent: 10, gstRate: 18, hsnCode: "6907" }], "intra");
    expect(q.lines[0].taxableValue.toFixed(2)).toBe("7951.50");
    expect(q.cgstTotal.toFixed(2)).toBe("715.64");
    expect(q.sgstTotal.toFixed(2)).toBe("715.64");
    expect(q.roundOff.toFixed(2)).toBe("0.22");
    expect(q.grandTotal.toFixed(2)).toBe("9383.00");
  });

  it("supports rates with paise (1007.50 per box)", () => {
    const q = computeQuotation([{ kind: "product", quantity: 3, rate: "1007.50", discountPercent: 0, gstRate: 18, hsnCode: "6907" }], "intra");
    expect(q.taxableTotal.toFixed(2)).toBe("3022.50");
    expect(q.cgstTotal.toFixed(2)).toBe("272.03"); // 272.025 half-up
    expect(q.grandTotal.toFixed(2)).toBe("3567.00"); // 3022.50 + 544.06 = 3566.56 -> 3567
    expect(q.roundOff.toFixed(2)).toBe("0.44");
  });

  it("gives a charge line its own GST rate", () => {
    const q = computeQuotation(
      [
        { kind: "product", quantity: 1, rate: "1000.00", discountPercent: 0, gstRate: 18, hsnCode: "6907" },
        { kind: "charge", quantity: 1, rate: "500.00", discountPercent: 0, gstRate: 5, hsnCode: "9965" },
      ],
      "intra",
    );
    // CGST: 1000 x 9% = 90.00 plus 500 x 2.5% = 12.50
    expect(q.cgstTotal.toFixed(2)).toBe("102.50");
    expect(q.sgstTotal.toFixed(2)).toBe("102.50");
    expect(q.grandTotal.toFixed(2)).toBe("1705.00");
    expect(q.roundOff.toFixed(2)).toBe("0.00");
  });

  it("round-off can be negative", () => {
    // 100.30 taxable, 9.03 each -> 118.36 -> 118.00, round-off -0.36
    const q = computeQuotation([{ kind: "product", quantity: 1, rate: "100.30", discountPercent: 0, gstRate: 18, hsnCode: "6907" }], "intra");
    expect(q.roundOff.toFixed(2)).toBe("-0.36");
    expect(q.grandTotal.toFixed(2)).toBe("118.00");
  });

  it("zero-rated (0%) lines add no tax", () => {
    const q = computeQuotation([{ kind: "product", quantity: 2, rate: "250.00", discountPercent: 0, gstRate: 0, hsnCode: "" }], "inter");
    expect(q.igstTotal.toFixed(2)).toBe("0.00");
    expect(q.grandTotal.toFixed(2)).toBe("500.00");
  });

  it("shows advance and the balance after it", () => {
    const q = computeQuotation([tile, transport], "intra", { advance: "1000" });
    expect(q.advance.toFixed(2)).toBe("1000.00");
    expect(q.balance.toFixed(2)).toBe("2387.00");
  });

  it("builds the HSN-wise summary, merging lines with the same HSN and rate", () => {
    const q = computeQuotation(
      [tile, { ...tile, quantity: 2, rate: "600.00" }, transport],
      "intra",
    );
    expect(q.hsnSummary).toHaveLength(2);
    const [tiles, freight] = q.hsnSummary;
    expect(tiles).toMatchObject({ hsnCode: "6907", gstRate: "18" });
    expect(tiles.taxableValue.toFixed(2)).toBe("3520.00"); // 2320 + 1200
    expect(tiles.cgst.toFixed(2)).toBe("316.80");
    expect(freight).toMatchObject({ hsnCode: "8704", gstRate: "18" });
    expect(freight.taxableValue.toFixed(2)).toBe("550.00");
    expect(freight.cgst.toFixed(2)).toBe("49.50");
  });

  it("an empty quotation is rejected", () => {
    expect(() => computeQuotation([], "intra")).toThrow(/at least one line/i);
  });

  it("rejects quantity <= 0 and discount outside 0-100", () => {
    expect(() => computeQuotation([{ ...tile, quantity: 0 }], "intra")).toThrow(/quantity/i);
    expect(() => computeQuotation([{ ...tile, discountPercent: 101 }], "intra")).toThrow(/discount/i);
    expect(() => computeQuotation([{ ...tile, discountPercent: -1 }], "intra")).toThrow(/discount/i);
  });
});
