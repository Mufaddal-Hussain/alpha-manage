import { describe, expect, it } from "vitest";
import { diffAgainstCurrent, type CurrentGroup } from "@/lib/import/price-list-diff";
import type { PriceRow } from "@/lib/import/price-list-rules";

const incoming = (o: Partial<PriceRow> = {}): PriceRow => ({
  brand: "colortile",
  listLabel: null,
  effectiveFrom: "2026-09-01",
  size: "600 x 600",
  lengthMm: 600,
  widthMm: 600,
  piecesPerBox: 4,
  sqftPerBox: "15.50",
  finish: "Rustic Matt",
  ratePerBox: "883.50",
  ratePerSqft: "57.00",
  designs: ["Imperia Silver", "Imperia Pearl"],
  hsnCode: null,
  ...o,
});

const current = (o: Partial<CurrentGroup> = {}): CurrentGroup => ({
  sizeLabel: "600 x 600",
  finish: "Rustic Matt",
  piecesPerBox: 4,
  sqftPerBox: "15.500",
  ratePerBox: "883.50",
  ratePerSqft: "57.00",
  designs: ["Imperia Silver", "Imperia Pearl"],
  ...o,
});

describe("diffAgainstCurrent", () => {
  it("marks everything new when the brand has no published list", () => {
    const { rows, removed } = diffAgainstCurrent([], [incoming()]);
    expect(rows[0].kind).toBe("new");
    expect(rows[0].designs.map((d) => d.kind)).toEqual(["new", "new"]);
    expect(removed).toEqual([]);
  });

  it("marks a design with the same rate and packing unchanged", () => {
    const { rows } = diffAgainstCurrent([current()], [incoming()]);
    expect(rows[0].kind).toBe("unchanged");
  });

  it("marks designs changed when the rate per box differs, and remembers the old rate", () => {
    const { rows } = diffAgainstCurrent([current()], [incoming({ ratePerBox: "899.00", ratePerSqft: "58.00" })]);
    expect(rows[0].kind).toBe("changed");
    expect(rows[0].designs).toEqual([
      { name: "Imperia Silver", kind: "changed", previousRatePerBox: "883.50" },
      { name: "Imperia Pearl", kind: "changed", previousRatePerBox: "883.50" },
    ]);
  });

  it("treats a change in packing as a change", () => {
    const { rows } = diffAgainstCurrent([current()], [incoming({ piecesPerBox: 6, sqftPerBox: "15.00" })]);
    expect(rows[0].kind).toBe("changed");
  });

  it("matches on size, finish and design, ignoring case and spacing", () => {
    const { rows } = diffAgainstCurrent([current()], [incoming({ size: "600  x 600", finish: "rustic matt", designs: ["IMPERIA  silver"] })]);
    expect(rows[0].designs[0].kind).toBe("unchanged");
  });

  it("does not match the same design under another finish or size", () => {
    const { rows } = diffAgainstCurrent([current()], [incoming({ finish: "Stone" }), incoming({ size: "1200 x 600" })]);
    expect(rows.map((r) => r.kind)).toEqual(["new", "new"]);
  });

  it("a row mixing new and unchanged designs is new; with a changed design it is changed", () => {
    const mixedNew = diffAgainstCurrent([current()], [incoming({ designs: ["Imperia Silver", "Imperia Teal"] })]);
    expect(mixedNew.rows[0].kind).toBe("new");
    expect(mixedNew.rows[0].designs.map((d) => d.kind)).toEqual(["unchanged", "new"]);
    const mixedChanged = diffAgainstCurrent([current({ designs: ["Imperia Silver"] })], [incoming({ ratePerBox: "899.00", ratePerSqft: "58.00", designs: ["Imperia Silver", "Imperia Teal"] })]);
    expect(mixedChanged.rows[0].kind).toBe("changed");
  });

  it("reports designs missing from the new list as removed, grouped by their old group, never as anything else", () => {
    const { rows, removed } = diffAgainstCurrent([current({ designs: ["Imperia Silver", "Imperia Pearl", "Star white"] })], [incoming({ designs: ["Imperia Silver", "Imperia Pearl"] })]);
    expect(rows[0].kind).toBe("unchanged");
    expect(removed).toEqual([
      expect.objectContaining({ sizeLabel: "600 x 600", finish: "Rustic Matt", ratePerBox: "883.50", designs: ["Star white"] }),
    ]);
  });

  it("does not call a design removed when an unreadable row might still contain it", () => {
    const { removed } = diffAgainstCurrent([current({ designs: ["Imperia Silver", "Star white"] })], [], { unreadableDesigns: ["star WHITE"] });
    expect(removed).toHaveLength(1);
    expect(removed[0].designs).toEqual(["Imperia Silver"]);
  });

  it("keeps a group with two price rows apart (Icon Matt & Rustic)", () => {
    const old = [
      current({ finish: "Matt & Rustic", ratePerBox: "899.00", ratePerSqft: "58.00", designs: ["Elementi Bianco"] }),
      current({ finish: "Matt & Rustic", ratePerBox: "930.00", ratePerSqft: "60.00", designs: ["Trust Brown"] }),
    ];
    const { rows, removed } = diffAgainstCurrent(old, [
      incoming({ finish: "Matt & Rustic", ratePerBox: "899.00", ratePerSqft: "58.00", designs: ["Elementi Bianco"] }),
      incoming({ finish: "Matt & Rustic", ratePerBox: "940.00", ratePerSqft: "60.65", designs: ["Trust Brown"] }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["unchanged", "changed"]);
    expect(removed).toEqual([]);
  });
});
