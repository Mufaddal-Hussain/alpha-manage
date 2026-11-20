import { describe, expect, it } from "vitest";
import { GSTIN_PATTERN, gstinStateCode, normaliseGstin, validateGstin } from "@/lib/gstin";

describe("GSTIN pattern", () => {
  it("accepts the sample GSTINs from the owner's documents", () => {
    expect(GSTIN_PATTERN.test("08BOSPP7444G1ZA")).toBe(true); // Radius 9 Innovations, Rajasthan
    expect(GSTIN_PATTERN.test("27ABYFA7430K1ZT")).toBe(true); // Alpha Tiles, Maharashtra
  });

  it.each([
    ["too short", "08BOSPP7444G1Z"],
    ["too long", "08BOSPP7444G1ZAA"],
    ["lowercase", "08bospp7444g1za"],
    ["letters where the state code goes", "AABOSPP7444G1ZA"],
    ["digit inside the PAN letters", "081OSPP7444G1ZA"],
    ["letter inside the PAN digits", "08BOSPP74A4G1ZA"],
    ["14th character not Z", "08BOSPP7444G1XA"],
    ["entity number 0", "08BOSPP7444G0ZA"],
    ["spaces", "08BOSPP7444 G1ZA"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(GSTIN_PATTERN.test(value)).toBe(false);
  });
});

describe("gstinStateCode", () => {
  it("is the first two digits", () => {
    expect(gstinStateCode("08BOSPP7444G1ZA")).toBe("08");
    expect(gstinStateCode("27ABYFA7430K1ZT")).toBe("27");
  });
});

describe("normaliseGstin", () => {
  it("trims and upper-cases; empty becomes null", () => {
    expect(normaliseGstin("  08bospp7444g1za ")).toBe("08BOSPP7444G1ZA");
    expect(normaliseGstin("")).toBeNull();
    expect(normaliseGstin("   ")).toBeNull();
    expect(normaliseGstin(null)).toBeNull();
    expect(normaliseGstin(undefined)).toBeNull();
  });
});

describe("validateGstin", () => {
  it("accepts a valid GSTIN whose first two digits match the state code", () => {
    expect(validateGstin("08BOSPP7444G1ZA", "08")).toBeNull();
    expect(validateGstin("27ABYFA7430K1ZT", "27")).toBeNull();
  });

  it("accepts a missing GSTIN (optional for individuals)", () => {
    expect(validateGstin(null, "27")).toBeNull();
    expect(validateGstin("", "27")).toBeNull();
  });

  it("rejects a malformed GSTIN with a format message", () => {
    expect(validateGstin("08BOSPP7444G1Z", "08")).toMatch(/15 characters/i);
    expect(validateGstin("NOTAGSTIN", "08")).toMatch(/15 characters/i);
  });

  it("rejects a GSTIN whose first two digits disagree with the state code", () => {
    expect(validateGstin("08BOSPP7444G1ZA", "27")).toMatch(/state/i);
    expect(validateGstin("27ABYFA7430K1ZT", "08")).toMatch(/state/i);
  });

  it("checks the format before the state match", () => {
    expect(validateGstin("bad", "27")).toMatch(/15 characters/i);
  });
});
