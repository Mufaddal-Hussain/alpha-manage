import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customer, customerAddress } from "@/db/schema";
import { findCustomers } from "@/server/customer-queries";
import { closeTestDb, getTestDb, hasTestDb } from "./helpers";

// Needs the TEST database (see numbering.test.ts). Rows use a unique name prefix and are removed afterwards.
const suite = hasTestDb() ? describe : describe.skip;
if (!hasTestDb()) {
  console.warn("[integration] SKIPPED customers.test.ts: TEST_DATABASE_URL is not set (see .env.example)");
}

const PREFIX = "ZZTEST ";

const radius = {
  type: "company" as const,
  displayName: `${PREFIX}Radius 9 Innovations`,
  gstin: "08BOSPP7444G1ZA",
  stateCode: "08",
  phone: "+91 90214 72657",
};

async function cleanup() {
  const db = await getTestDb();
  await db.delete(customer).where(like(customer.displayName, `${PREFIX}%`));
}

suite("customer master (real Postgres)", () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await closeTestDb();
  });

  it("stores Radius 9 Innovations with its GSTIN and state", async () => {
    const db = await getTestDb();
    const [row] = await db.insert(customer).values(radius).returning();
    expect(row.gstin).toBe("08BOSPP7444G1ZA");
    expect(row.stateCode).toBe("08");
    expect(row.active).toBe(true);
  });

  it("refuses a malformed GSTIN even if application validation were bypassed", async () => {
    const db = await getTestDb();
    await expect(
      db.insert(customer).values({ ...radius, displayName: `${PREFIX}bad format`, gstin: "08BOSPP7444G1Z" }),
    ).rejects.toThrow();
  });

  it("refuses a GSTIN whose first two digits differ from the state code", async () => {
    const db = await getTestDb();
    await expect(
      db.insert(customer).values({ ...radius, displayName: `${PREFIX}bad state`, stateCode: "27" }),
    ).rejects.toThrow();
  });

  it("allows an individual with no GSTIN", async () => {
    const db = await getTestDb();
    const [row] = await db
      .insert(customer)
      .values({ type: "individual", displayName: `${PREFIX}Taher bhai`, stateCode: "27", phone: "9822012345" })
      .returning();
    expect(row.gstin).toBeNull();
  });

  it("allows only one default shipping address per customer", async () => {
    const db = await getTestDb();
    const [owner] = await db.select().from(customer).where(eq(customer.displayName, `${PREFIX}Taher bhai`));
    const address = { customerId: owner.id, addressLine1: "Lane 5", stateCode: "27" };
    await db.insert(customerAddress).values({ ...address, label: "Site A", isDefaultShipping: true });
    await db.insert(customerAddress).values({ ...address, label: "Site B", isDefaultShipping: false });
    await expect(db.insert(customerAddress).values({ ...address, label: "Site C", isDefaultShipping: true })).rejects.toThrow();
  });

  it("removes addresses with their customer", async () => {
    const db = await getTestDb();
    const [owner] = await db.select().from(customer).where(eq(customer.displayName, `${PREFIX}Taher bhai`));
    await db.delete(customer).where(eq(customer.id, owner.id));
    expect(await db.select().from(customerAddress).where(eq(customerAddress.customerId, owner.id))).toHaveLength(0);
  });

  describe("search", () => {
    beforeAll(async () => {
      const db = await getTestDb();
      await db
        .insert(customer)
        .values([
          { type: "individual", displayName: `${PREFIX}Taher bhai`, stateCode: "27", phone: "9822012345" },
          { type: "company", displayName: `${PREFIX}Old Client`, stateCode: "27", active: false },
        ]);
    });

    it("finds by name, case-insensitively", async () => {
      const found = await findCustomers(await getTestDb(), "radius 9");
      expect(found.map((c) => c.displayName)).toContain(radius.displayName);
    });

    it("finds by GSTIN, full or partial", async () => {
      const db = await getTestDb();
      expect((await findCustomers(db, "08BOSPP7444G1ZA")).map((c) => c.displayName)).toContain(radius.displayName);
      expect((await findCustomers(db, "bospp")).map((c) => c.displayName)).toContain(radius.displayName);
    });

    it("finds by phone ignoring spaces and punctuation", async () => {
      const db = await getTestDb();
      expect((await findCustomers(db, "9021472657")).map((c) => c.displayName)).toContain(radius.displayName);
      expect((await findCustomers(db, "90214 72657")).map((c) => c.displayName)).toContain(radius.displayName);
      expect((await findCustomers(db, "98220")).map((c) => c.displayName)).toContain(`${PREFIX}Taher bhai`);
    });

    it("treats % and _ literally", async () => {
      const db = await getTestDb();
      expect(await findCustomers(db, "ZZTEST %")).toHaveLength(0);
      expect(await findCustomers(db, "ZZTEST_")).toHaveLength(0);
    });

    it("hides inactive customers unless asked", async () => {
      const db = await getTestDb();
      expect((await findCustomers(db, "Old Client")).map((c) => c.displayName)).not.toContain(`${PREFIX}Old Client`);
      expect((await findCustomers(db, "Old Client", { includeInactive: true })).map((c) => c.displayName)).toContain(`${PREFIX}Old Client`);
    });
  });
});
