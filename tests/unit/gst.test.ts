import { describe, expect, it } from "vitest";
import { computeDocumentTotals, computeLine, splitTax, taxMode } from "@/lib/gst";
import { getStateByCode, STATE_CODES } from "@/lib/gst/state-codes";

describe("tax mode (place of supply)", () => {
  it("is intra-state when place of supply equals the business state", () => {
    expect(taxMode("27", "27")).toBe("intra");
  });

  it("is inter-state when the states differ", () => {
    expect(taxMode("08", "27")).toBe("inter");
  });
});

describe("splitTax", () => {
  it("splits an intra-state rate into CGST and SGST at half the rate each", () => {
    const tax = splitTax("2870.00", "18", "intra");
    expect(tax.cgst.toFixed(2)).toBe("258.30");
    expect(tax.sgst.toFixed(2)).toBe("258.30");
    expect(tax.igst.toFixed(2)).toBe("0.00");
    expect(tax.total.toFixed(2)).toBe("516.60");
  });

  it("charges the full rate as IGST when inter-state", () => {
    const tax = splitTax("2870.00", "18", "inter");
    expect(tax.igst.toFixed(2)).toBe("516.60");
    expect(tax.cgst.toFixed(2)).toBe("0.00");
    expect(tax.sgst.toFixed(2)).toBe("0.00");
    expect(tax.total.toFixed(2)).toBe("516.60");
  });

  it("rounds CGST and SGST each to 2 dp half-up", () => {
    // 100.10 x 9% = 9.009 -> 9.01 each
    const tax = splitTax("100.10", "18", "intra");
    expect(tax.cgst.toFixed(2)).toBe("9.01");
    expect(tax.sgst.toFixed(2)).toBe("9.01");
  });

  it("handles a zero rate", () => {
    expect(splitTax("500.00", "0", "intra").total.toFixed(2)).toBe("0.00");
  });
});

describe("computeLine", () => {
  it("computes taxable value and tax for a product line (4 box x 580.00)", () => {
    const line = computeLine({ quantity: "4", rate: "580.00", discountPercent: "0", gstRate: "18" }, "intra");
    expect(line.taxableValue.toFixed(2)).toBe("2320.00");
    expect(line.cgst.toFixed(2)).toBe("208.80");
    expect(line.sgst.toFixed(2)).toBe("208.80");
    expect(line.lineTotal.toFixed(2)).toBe("2737.60");
  });

  it("applies the discount percent before tax", () => {
    const line = computeLine({ quantity: "10", rate: "100.00", discountPercent: "10", gstRate: "18" }, "inter");
    expect(line.taxableValue.toFixed(2)).toBe("900.00");
    expect(line.igst.toFixed(2)).toBe("162.00");
    expect(line.lineTotal.toFixed(2)).toBe("1062.00");
  });
});

describe("Radius 9 acceptance case (document totals)", () => {
  const lines = [
    { quantity: "4", rate: "580.00", discountPercent: "0", gstRate: "18" }, // ATN 600X600 Plain Ivory Matt
    { quantity: "1", rate: "550.00", discountPercent: "0", gstRate: "18" }, // Transport Charges
  ];

  it("intra-state: taxable 2,870.00, CGST 258.30, SGST 258.30, round-off +0.40, total 3,387.00", () => {
    const totals = computeDocumentTotals(lines, "intra");
    expect(totals.taxableTotal.toFixed(2)).toBe("2870.00");
    expect(totals.cgstTotal.toFixed(2)).toBe("258.30");
    expect(totals.sgstTotal.toFixed(2)).toBe("258.30");
    expect(totals.igstTotal.toFixed(2)).toBe("0.00");
    expect(totals.roundOff.toFixed(2)).toBe("0.40");
    expect(totals.grandTotal.toFixed(2)).toBe("3387.00");
  });

  it("inter-state: IGST 516.60 on the same lines", () => {
    const totals = computeDocumentTotals(lines, "inter");
    expect(totals.taxableTotal.toFixed(2)).toBe("2870.00");
    expect(totals.igstTotal.toFixed(2)).toBe("516.60");
    expect(totals.cgstTotal.toFixed(2)).toBe("0.00");
    expect(totals.sgstTotal.toFixed(2)).toBe("0.00");
    expect(totals.grandTotal.toFixed(2)).toBe("3387.00");
  });

  it("returns per-line results in order", () => {
    const totals = computeDocumentTotals(lines, "intra");
    expect(totals.lines.map((l) => l.taxableValue.toFixed(2))).toEqual(["2320.00", "550.00"]);
  });
});

describe("state codes", () => {
  it("lists Maharashtra as 27 and Rajasthan as 08", () => {
    expect(getStateByCode("27")?.name).toBe("Maharashtra");
    expect(getStateByCode("08")?.name).toBe("Rajasthan");
  });

  it("returns undefined for an unknown code", () => {
    expect(getStateByCode("00")).toBeUndefined();
    expect(getStateByCode("")).toBeUndefined();
  });

  it("has unique two-digit codes", () => {
    const codes = STATE_CODES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^\d{2}$/.test(c))).toBe(true);
  });
});
