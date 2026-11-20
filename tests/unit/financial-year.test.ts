import { describe, expect, it } from "vitest";
import { financialYearLabel, financialYearOf } from "@/lib/financial-year";

// Dates are built as IST wall-clock times (+05:30): the business runs on Indian time.
const ist = (iso: string) => new Date(`${iso}+05:30`);

describe("financialYearOf (April to March)", () => {
  it("labels a date in the first half of the year with the next year's suffix", () => {
    expect(financialYearOf(ist("2026-11-20T10:00:00"))).toBe("2026-27");
  });

  it("labels January to March with the previous April's year", () => {
    expect(financialYearOf(ist("2027-02-15T10:00:00"))).toBe("2026-27");
  });

  it("stays in the old year on 31 March, even at the last second", () => {
    expect(financialYearOf(ist("2027-03-31T00:00:00"))).toBe("2026-27");
    expect(financialYearOf(ist("2027-03-31T23:59:59"))).toBe("2026-27");
  });

  it("starts the new year on 1 April", () => {
    expect(financialYearOf(ist("2027-04-01T00:00:00"))).toBe("2027-28");
  });

  it("uses India time, not UTC, at the boundary", () => {
    // 2027-03-31 20:00 UTC is 01:30 on 1 April in India
    expect(financialYearOf(new Date("2027-03-31T20:00:00Z"))).toBe("2027-28");
    // 2027-03-31 18:00 UTC is 23:30 on 31 March in India
    expect(financialYearOf(new Date("2027-03-31T18:00:00Z"))).toBe("2026-27");
  });

  it("keeps two-digit suffixes across a century", () => {
    expect(financialYearOf(ist("2099-05-01T00:00:00"))).toBe("2099-00");
  });
});

describe("financialYearLabel", () => {
  it("builds the label from the starting year", () => {
    expect(financialYearLabel(2026)).toBe("2026-27");
    expect(financialYearLabel(2009)).toBe("2009-10");
  });
});
