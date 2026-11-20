import { describe, expect, it } from "vitest";
import { DEFAULT_FORMATS, formatNumber, validateFormat } from "@/lib/numbering";

describe("formatNumber", () => {
  it("replaces {FY} and an unpadded {N}", () => {
    expect(formatNumber("QT/{FY}/{N}", "2026-27", 3)).toBe("QT/2026-27/3");
  });

  it("zero-pads {N:4}", () => {
    expect(formatNumber("QT/{FY}/{N:4}", "2026-27", 3)).toBe("QT/2026-27/0003");
    expect(formatNumber("CH/{FY}/{N:4}", "2026-27", 12345)).toBe("CH/2026-27/12345");
  });
});

describe("validateFormat", () => {
  it("accepts formats with both {FY} and {N}", () => {
    expect(validateFormat("QT/{FY}/{N}")).toBeNull();
    expect(validateFormat("{N:5}-{FY}")).toBeNull();
  });

  it("rejects a format without {N}", () => {
    expect(validateFormat("QT/{FY}")).toMatch(/\{N\}/);
  });

  it("rejects a format without {FY}: numbers restart each year and would repeat", () => {
    expect(validateFormat("QT/{N}")).toMatch(/\{FY\}/);
  });

  it("rejects unknown placeholders, absurd padding and over-long formats", () => {
    expect(validateFormat("QT/{FY}/{N}/{X}")).toMatch(/\{X\}/);
    expect(validateFormat("QT/{FY}/{N:12}")).not.toBeNull();
    expect(validateFormat("A".repeat(60) + "{FY}{N}")).not.toBeNull();
  });
});

describe("DEFAULT_FORMATS", () => {
  it("are valid formats", () => {
    for (const format of Object.values(DEFAULT_FORMATS)) expect(validateFormat(format)).toBeNull();
  });
});
