import { describe, expect, it } from "vitest";
import { add, dec, formatMoney, mul, round2, roundOff } from "@/lib/money";

describe("money helpers", () => {
  it("adds decimals exactly where JS floats drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the trap this module exists to avoid
    expect(add("0.1", "0.2").toFixed(2)).toBe("0.30");
    expect(add("0.1", "0.2").equals(dec("0.3"))).toBe(true);
  });

  it("adds any number of values", () => {
    expect(add("2320.00", "550.00", "258.30", "258.30").toFixed(2)).toBe("3386.60");
    expect(add().toFixed(2)).toBe("0.00");
  });

  it("multiplies quantity by rate without rounding", () => {
    expect(mul(4, "580.00").toFixed(2)).toBe("2320.00");
    expect(mul("1.5", "1007.50").toFixed(3)).toBe("1511.250");
  });

  it("rounds to 2 dp half-up, even where floats round down", () => {
    expect(Number((1.005).toFixed(2))).toBe(1); // float behaviour we must not inherit
    expect(round2("1.005").toFixed(2)).toBe("1.01");
    expect(round2("258.295").toFixed(2)).toBe("258.30");
    expect(round2("258.294").toFixed(2)).toBe("258.29");
  });

  it("returns the signed round-off to the nearest rupee: 3,386.60 -> +0.40", () => {
    const result = roundOff("3386.60");
    expect(result.roundOff.toFixed(2)).toBe("0.40");
    expect(result.rounded.toFixed(2)).toBe("3387.00");
  });

  it("returns a negative round-off when rounding down", () => {
    const result = roundOff("3386.40");
    expect(result.roundOff.toFixed(2)).toBe("-0.40");
    expect(result.rounded.toFixed(2)).toBe("3386.00");
  });

  it("rounds exactly half a rupee up and leaves whole rupees alone", () => {
    expect(roundOff("100.50").rounded.toFixed(2)).toBe("101.00");
    expect(roundOff("100.50").roundOff.toFixed(2)).toBe("0.50");
    expect(roundOff("100.00").roundOff.toFixed(2)).toBe("0.00");
  });

  it("formats money as a plain 2 dp string for NUMERIC columns", () => {
    expect(formatMoney("3387")).toBe("3387.00");
    expect(formatMoney(dec("258.3"))).toBe("258.30");
    expect(formatMoney("1.005")).toBe("1.01");
  });
});
