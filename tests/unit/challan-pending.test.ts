import { describe, expect, it } from "vitest";
import { lineQuantity, statusFromQuantities } from "@/lib/challan/pending";
import { ValidationError } from "@/lib/errors";
import { parseCancelChallan, parseChallan } from "@/lib/challan/schema";

const ID = "6f1e2c1a-0b7e-4c53-9d0e-2f3a4b5c6d7e";

describe("pending quantity", () => {
  it("is ordered minus delivered, never below zero, with the excess reported separately", () => {
    expect(lineQuantity(ID, 1, "100.000", "60.000")).toMatchObject({ ordered: "100.000", delivered: "60.000", pending: "40.000", excess: "0.000" });
    expect(lineQuantity(ID, 1, "100", "100")).toMatchObject({ pending: "0.000", excess: "0.000" });
    expect(lineQuantity(ID, 1, "100", "101")).toMatchObject({ pending: "0.000", excess: "1.000" });
    expect(lineQuantity(ID, 1, "0.3", "0.1")).toMatchObject({ pending: "0.200" }); // exact decimals, no float drift
  });
});

describe("PO status from delivered quantities", () => {
  const line = (ordered: string, delivered: string) => ({ ordered, delivered });
  it("is open until something is delivered", () => {
    expect(statusFromQuantities([line("100", "0"), line("10", "0")], "open")).toBe("open");
    expect(statusFromQuantities([], "open")).toBe("open");
  });
  it("is partially delivered while any line still has pending quantity", () => {
    expect(statusFromQuantities([line("100", "60"), line("10", "0")], "open")).toBe("partially_delivered");
    expect(statusFromQuantities([line("100", "100"), line("10", "0")], "open")).toBe("partially_delivered");
  });
  it("is delivered when every line has received at least its ordered quantity", () => {
    expect(statusFromQuantities([line("100", "100"), line("10", "10")], "partially_delivered")).toBe("delivered");
    expect(statusFromQuantities([line("100", "101"), line("10", "10")], "partially_delivered")).toBe("delivered");
  });
  it("goes back when quantities are freed, and a cancelled PO stays cancelled", () => {
    expect(statusFromQuantities([line("100", "40")], "delivered")).toBe("partially_delivered");
    expect(statusFromQuantities([line("100", "0")], "partially_delivered")).toBe("open");
    expect(statusFromQuantities([line("100", "100")], "cancelled")).toBe("cancelled");
  });
});

describe("challan input", () => {
  const base = { purchaseOrderId: ID, challanDate: "2026-11-21", lines: [{ poLineId: ID, quantity: "5" }] };
  it("defaults optional text to null and prices to hidden", () => {
    expect(parseChallan({ ...base, vehicleNo: "  ", driverName: " Ramesh " })).toMatchObject({ vehicleNo: null, driverName: "Ramesh", showPrices: false, overrideReason: null });
  });
  it("needs at least one line with a positive quantity of at most three decimals", () => {
    expect(() => parseChallan({ ...base, lines: [] })).toThrow(/at least one item/);
    expect(() => parseChallan({ ...base, lines: [{ poLineId: ID, quantity: "0" }] })).toThrow(/more than zero/);
    expect(() => parseChallan({ ...base, lines: [{ poLineId: ID, quantity: "1.2345" }] })).toThrow(ValidationError);
    expect(() => parseChallan({ ...base, lines: [{ poLineId: ID, quantity: "1e3" }] })).toThrow(ValidationError);
  });
  it("checks the date and the consignee's state", () => {
    expect(() => parseChallan({ ...base, challanDate: "21/11/2026" })).toThrow(/date/);
    expect(() => parseChallan({ ...base, consignee: { name: "Site", stateCode: "55" } })).toThrow(/state/i);
    expect(parseChallan({ ...base, consignee: { name: "Site", stateCode: "27", gstin: " " } }).consignee).toMatchObject({ gstin: null });
  });
  it("cancelling needs an id and a reason", () => {
    expect(parseCancelChallan({ id: ID, reason: " wrong vehicle " }).reason).toBe("wrong vehicle");
    expect(() => parseCancelChallan({ id: ID, reason: " " })).toThrow(/reason/);
    expect(() => parseCancelChallan({ id: "nope", reason: "x y z" })).toThrow(ValidationError);
  });
});
