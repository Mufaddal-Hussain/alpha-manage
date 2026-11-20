import { describe, expect, it } from "vitest";
import { addDays, allowedActions, canDo, effectiveStatus, istDate } from "@/lib/quotation/status";

describe("quotation status machine", () => {
  it("expires a sent quotation the day after valid_until, in India time", () => {
    const lastDay = new Date("2026-12-06T23:30:00+05:30");
    const nextDay = new Date("2026-12-07T00:30:00+05:30");
    expect(effectiveStatus("sent", "2026-12-06", lastDay)).toBe("sent");
    expect(effectiveStatus("sent", "2026-12-06", nextDay)).toBe("expired");
  });

  it("only a sent quotation can expire", () => {
    const later = new Date("2030-01-01T10:00:00+05:30");
    expect(effectiveStatus("draft", "2026-12-06", later)).toBe("draft");
    expect(effectiveStatus("approved", "2026-12-06", later)).toBe("approved");
    expect(effectiveStatus("rejected", "2026-12-06", later)).toBe("rejected");
  });

  it("offers only the valid next actions", () => {
    expect(allowedActions("draft", false)).toEqual(["issue", "send", "delete"]);
    expect(allowedActions("draft", true)).toEqual(["issue", "send"]); // a revision in progress cannot be deleted
    expect(allowedActions("sent", true)).toEqual(["send", "approve", "reject", "revise"]);
    expect(allowedActions("expired", true)).toEqual(["reinstate", "revise"]);
    expect(allowedActions("rejected", true)).toEqual(["reinstate", "revise"]);
    expect(allowedActions("approved", true)).toEqual([]);
  });

  it("approved quotations cannot be revised, and expired ones cannot be approved", () => {
    expect(canDo("revise", "approved", true)).toBe(false);
    expect(canDo("approve", "expired", true)).toBe(false);
    expect(canDo("approve", "sent", true)).toBe(true);
  });

  it("date helpers", () => {
    expect(istDate(new Date("2026-03-31T20:00:00Z"))).toBe("2026-04-01"); // 01:30 IST next day
    expect(addDays("2026-11-21", 15)).toBe("2026-12-06");
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });
});
