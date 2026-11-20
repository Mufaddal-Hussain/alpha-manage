import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { numberSeries } from "@/db/schema";
import { nextNumber } from "@/lib/numbering";
import { closeTestDb, getTestDb, hasTestDb } from "./helpers";

// Needs a real Postgres: TEST_DATABASE_URL (a separate Neon branch/database, never the main one).
// When it is absent the whole file is reported as SKIPPED with a reason; it never passes silently.
const suite = hasTestDb() ? describe : describe.skip;
if (!hasTestDb()) {
  console.warn("[integration] SKIPPED numbering.test.ts: TEST_DATABASE_URL is not set (see .env.example)");
}

// Dates in the 2090s so test rows can never collide with real financial years.
const FY_A = new Date("2095-06-15T10:00:00+05:30"); // 2095-96
const FY_B = new Date("2096-04-01T10:00:00+05:30"); // 2096-97
const TEST_FYS = ["2095-96", "2096-97"];

suite("gap-free numbering (real Postgres)", () => {
  beforeAll(async () => {
    const db = await getTestDb();
    await db.delete(numberSeries).where(inArray(numberSeries.financialYear, TEST_FYS));
  });

  afterAll(async () => {
    const db = await getTestDb();
    await db.delete(numberSeries).where(inArray(numberSeries.financialYear, TEST_FYS));
    await closeTestDb();
  });

  it("issues 50 concurrent numbers that are unique and consecutive", async () => {
    const db = await getTestDb();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => db.transaction((tx) => nextNumber(tx, "quotation", FY_A))),
    );

    const values = results.map((r) => r.value).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(results.map((r) => r.number)).size).toBe(50);
    expect(results.every((r) => r.financialYear === "2095-96")).toBe(true);
    expect(results.find((r) => r.value === 1)?.number).toBe("QT/2095-96/0001");
  });

  it("restarts at 1 in a new financial year, keeping the series format", async () => {
    const db = await getTestDb();
    const first = await db.transaction((tx) => nextNumber(tx, "quotation", FY_B));
    expect(first.value).toBe(1);
    expect(first.financialYear).toBe("2096-97");
    expect(first.number).toBe("QT/2096-97/0001");
  });

  it("keeps series independent of each other", async () => {
    const db = await getTestDb();
    const challan = await db.transaction((tx) => nextNumber(tx, "challan", FY_A));
    expect(challan.value).toBe(1);
    expect(challan.number).toBe("CH/2095-96/0001");
  });

  it("does not consume a number when the transaction rolls back", async () => {
    const db = await getTestDb();
    const before = await db.transaction((tx) => nextNumber(tx, "challan", FY_A));

    await expect(
      db.transaction(async (tx) => {
        await nextNumber(tx, "challan", FY_A);
        throw new Error("document insert failed");
      }),
    ).rejects.toThrow("document insert failed");

    const after = await db.transaction((tx) => nextNumber(tx, "challan", FY_A));
    expect(after.value).toBe(before.value + 1);

    const [row] = await db.select().from(numberSeries).where(eq(numberSeries.financialYear, "2095-96"));
    expect(row.lastValue).toBeGreaterThan(0);
  });

  it("uses a format edited in settings for later numbers", async () => {
    const db = await getTestDb();
    await db
      .update(numberSeries)
      .set({ format: "EST/{FY}/{N}" })
      .where(eq(numberSeries.financialYear, "2096-97"));
    const next = await db.transaction((tx) => nextNumber(tx, "quotation", FY_B));
    expect(next.number).toBe("EST/2096-97/2");
  });
});
