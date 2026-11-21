import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { parsePurchaseOrder } from "@/lib/order/schema";
import { orderValue } from "@/lib/order/value";
import { canRecordPurchaseOrder, purchaseOrderRefusal, type DisplayStatus } from "@/lib/quotation/status";

const ID = "6f1e2c1a-0b7e-4c53-9d0e-2f3a4b5c6d7e";
const base = { quotationId: ID, customerPoNumber: " PO-77 ", poDate: "2026-11-01", lines: [{ quotationLineId: ID, quantity: "3" }] };

describe("purchase order input", () => {
  it("trims the number, defaults the advance to 0 and drops an empty note", () => {
    const parsed = parsePurchaseOrder({ ...base, notes: "  " });
    expect(parsed).toMatchObject({ customerPoNumber: "PO-77", advanceReceived: "0", notes: null, fileIds: [], confirmDuplicate: false });
  });

  it("accepts up to three decimals of quantity and two of advance, never more", () => {
    expect(parsePurchaseOrder({ ...base, lines: [{ quotationLineId: ID, quantity: "62.5" }], advanceReceived: "1500.25" })).toBeTruthy();
    expect(() => parsePurchaseOrder({ ...base, lines: [{ quotationLineId: ID, quantity: "1.2345" }] })).toThrow(ValidationError);
    expect(() => parsePurchaseOrder({ ...base, advanceReceived: "10.001" })).toThrow(/advance/i);
    expect(() => parsePurchaseOrder({ ...base, advanceReceived: "1e3" })).toThrow(ValidationError);
  });

  it("names the line a quantity problem is on", () => {
    const lines = [
      { quotationLineId: ID, quantity: "3" },
      { quotationLineId: ID, quantity: "0" },
    ];
    expect(() => parsePurchaseOrder({ ...base, lines })).toThrow("Line 2: Quantity must be more than zero");
  });
});

describe("purchase order status gate", () => {
  it("only an approved quotation takes a PO", () => {
    const states: DisplayStatus[] = ["draft", "sent", "approved", "rejected", "expired"];
    expect(states.filter(canRecordPurchaseOrder)).toEqual(["approved"]);
  });

  it("tells rejected and expired quotations to be reinstated first", () => {
    expect(purchaseOrderRefusal("rejected")).toMatch(/reinstate/);
    expect(purchaseOrderRefusal("expired")).toMatch(/expired.*reinstate/);
    expect(purchaseOrderRefusal("sent")).toMatch(/approve/);
  });
});

describe("ordered value", () => {
  it("uses the quotation maths: discount, then GST by tax mode, exact decimals", () => {
    const lines = [
      { quantity: "3", rate: "580.00", discountPercent: "0", gstRate: "18" },
      { quantity: "10", rate: "1200.00", discountPercent: "10", gstRate: "18" },
    ];
    expect(orderValue(lines, "intra")).toEqual({ taxable: "12540.00", tax: "2257.20", total: "14797.20" });
    expect(orderValue(lines, "inter")).toEqual({ taxable: "12540.00", tax: "2257.20", total: "14797.20" });
  });

  it("is zero for no lines", () => {
    expect(orderValue([], "intra")).toEqual({ taxable: "0.00", tax: "0.00", total: "0.00" });
  });
});
