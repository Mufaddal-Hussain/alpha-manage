import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, businessProfile, customer, deliveryChallan, numberSeries, poLine, product, purchaseOrder, quotation, quotationLine, user } from "@/db/schema";
import { DEFAULT_FORMATS } from "@/lib/numbering";
import { auditFilterOptions, findAuditEntries } from "@/server/audit-queries";
import { cancelChallan, createChallan } from "@/server/challan-core";
import { getDashboardData } from "@/server/dashboard-queries";
import { recordPurchaseOrder } from "@/server/order-core";
import { approveQuotation, issueQuotation, saveDraft, type DraftInput } from "@/server/quotation-core";
import { closeTestDb, getTestDb, hasTestDb } from "./helpers";

// Needs the TEST database. Everything is prefixed ZZDB and dated in 2096-97, so it never meets real data; the lists are
// asked for a large limit and the assertions only look at this file's own rows (other test files may leave rows behind).
const suite = hasTestDb() ? describe : describe.skip;
if (!hasTestDb()) {
  console.warn("[integration] SKIPPED dashboard-audit.test.ts: TEST_DATABASE_URL is not set (see .env.example)");
}

const PREFIX = "ZZDB ";
const FY = "2096-97";
const NOW = new Date("2096-06-15T10:00:00+05:30");
const BIG = 10_000;

let ownerId: string;
let customerId: string;
let tileId: string;
let createdBusinessProfile = false;

/** `issuedAt` is the moment of issuing: an already-expired offer can only exist by issuing it earlier than the dashboard's "now". */
async function quote(validUntil: string, { quotationDate = "2096-06-10", issue = true, approve = false, boxes = "10", issuedAt = NOW } = {}) {
  const db = await getTestDb();
  const input: DraftInput = {
    customerId,
    quotationDate,
    validUntil,
    billTo: { name: `${PREFIX}Customer`, gstin: null, address: "Pune", stateCode: "27" },
    shipTo: { name: `${PREFIX}Site`, address: "Baner, Pune", stateCode: "27", contactName: null, contactPhone: null },
    layout: "gst_quotation",
    terms: null,
    advanceAmount: "0",
    notes: null,
    lines: [{ kind: "product", productId: tileId, description: `${PREFIX}Tile`, hsnCode: "6907", unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", quantity: boxes, rate: "580.00", discountPercent: "0", gstRate: "18" }],
  };
  const { id } = await saveDraft(db, ownerId, input, NOW);
  if (issue) await issueQuotation(db, ownerId, id, issuedAt);
  if (approve) await approveQuotation(db, ownerId, id, issuedAt);
  return id;
}

async function order(quotationId: string, po: string) {
  const db = await getTestDb();
  const lines = await db.select().from(quotationLine).innerJoin(quotation, eq(quotation.currentRevisionId, quotationLine.revisionId)).where(eq(quotation.id, quotationId));
  const { id } = await recordPurchaseOrder(db, ownerId, { quotationId, customerPoNumber: po, poDate: "2096-06-12", advanceReceived: "0", notes: null, lines: lines.map((r) => ({ quotationLineId: r.quotation_line.id, quantity: r.quotation_line.quantity })) }, NOW);
  const [pl] = await db.select().from(poLine).where(eq(poLine.purchaseOrderId, id));
  return { id, poLineId: pl.id };
}

async function cleanup() {
  const db = await getTestDb();
  const customers = await db.select({ id: customer.id }).from(customer).where(like(customer.displayName, `${PREFIX}%`));
  if (customers.length) {
    const ids = customers.map((c) => c.id);
    const challans = await db.select({ id: deliveryChallan.id }).from(deliveryChallan).where(inArray(deliveryChallan.customerId, ids));
    const pos = await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(inArray(purchaseOrder.customerId, ids));
    const quotes = await db.select({ id: quotation.id }).from(quotation).where(inArray(quotation.customerId, ids));
    const entityIds = [...challans.map((c) => c.id), ...pos.map((p) => p.id), ...quotes.map((q) => q.id)];
    if (entityIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, entityIds));
    await db.delete(deliveryChallan).where(inArray(deliveryChallan.customerId, ids));
    await db.delete(purchaseOrder).where(inArray(purchaseOrder.customerId, ids));
    await db.delete(quotation).where(inArray(quotation.customerId, ids));
    await db.delete(customer).where(inArray(customer.id, ids));
  }
  await db.delete(product).where(like(product.name, `${PREFIX}%`));
  await db.delete(user).where(like(user.email, "zztest-db-%"));
  await db.delete(numberSeries).where(eq(numberSeries.financialYear, FY));
}

suite("dashboard and audit log queries (real Postgres)", () => {
  beforeAll(async () => {
    await cleanup();
    const db = await getTestDb();
    const inserted = await db
      .insert(businessProfile)
      .values({ legalName: "ZZTEST Alpha Tiles", addressLine1: "Shop 4", city: "Pune", state: "Maharashtra", stateCode: "27" })
      .onConflictDoNothing()
      .returning({ id: businessProfile.id });
    createdBusinessProfile = inserted.length > 0;
    await db.insert(numberSeries).values([
      { series: "quotation", financialYear: FY, format: DEFAULT_FORMATS.quotation, lastValue: 0 },
      { series: "challan", financialYear: FY, format: DEFAULT_FORMATS.challan, lastValue: 0 },
    ]);
    const [o] = await db.insert(user).values({ name: "ZZTEST db owner", email: `zztest-db-owner-${Date.now()}@example.test`, role: "owner" }).returning({ id: user.id });
    ownerId = o.id;
    const [c] = await db.insert(customer).values({ type: "company", displayName: `${PREFIX}Customer`, stateCode: "27", addressLine1: "Pune" }).returning({ id: customer.id });
    customerId = c.id;
    const [t] = await db
      .insert(product)
      .values({ name: `${PREFIX}Tile`, unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", hsnCode: "6907", gstRate: "18", sellingPricePerUnit: "580.00" })
      .returning({ id: product.id });
    tileId = t.id;
  });

  afterAll(async () => {
    await cleanup();
    const db = await getTestDb();
    if (createdBusinessProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "ZZTEST Alpha Tiles"));
    await closeTestDb();
  });

  describe("dashboard", () => {
    it("lists open quotations, expiring soon (7 days) and POs with pending deliveries, and nothing else", { timeout: 240_000 }, async () => {
      const db = await getTestDb();
      // Each document is built through the real domain code over the network, so the independent ones run side by side.
      const [soon, lastDay, edge, later, expired, draft, approvedNoPo, openQ, doneQ, partialQ] = await Promise.all([
        quote("2096-06-18"), // 3 days left
        quote("2096-06-15"), // valid through today
        quote("2096-06-22"), // exactly 7 days: still "soon"
        quote("2096-06-23"), // 8 days: open, not expiring soon
        quote("2096-06-14", { issuedAt: new Date("2096-06-11T10:00:00+05:30") }), // sent, past its date by "now"
        quote("2096-07-01", { issue: false }),
        quote("2096-06-17", { approve: true }),
        quote("2096-06-30", { approve: true }),
        quote("2096-06-30", { approve: true }),
        quote("2096-06-30", { approve: true, boxes: "20" }),
      ]);
      const [open, done, partial] = await Promise.all([order(openQ, "ZZDB-PO-OPEN"), order(doneQ, "ZZDB-PO-DONE"), order(partialQ, "ZZDB-PO-PART")]);
      await Promise.all([
        createChallan(db, ownerId, { purchaseOrderId: done.id, challanDate: "2096-06-15", lines: [{ poLineId: done.poLineId, quantity: "10" }] }, NOW),
        createChallan(db, ownerId, { purchaseOrderId: partial.id, challanDate: "2096-06-15", lines: [{ poLineId: partial.poLineId, quantity: "5" }] }, NOW),
      ]);

      const data = await getDashboardData(db, { now: NOW, limit: BIG });
      const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));

      const awaiting = ids(data.openQuotations.rows);
      for (const id of [soon, lastDay, edge, later]) expect(awaiting.has(id)).toBe(true);
      for (const id of [expired, draft, approvedNoPo]) expect(awaiting.has(id)).toBe(false);

      const expiring = ids(data.expiringSoon.rows);
      for (const id of [soon, lastDay, edge]) expect(expiring.has(id)).toBe(true);
      for (const id of [later, expired, draft, approvedNoPo]) expect(expiring.has(id)).toBe(false);
      // Soonest first.
      const mine = data.expiringSoon.rows.filter((r) => [soon, lastDay, edge].includes(r.id)).map((r) => r.validUntil);
      expect(mine).toEqual(["2096-06-15", "2096-06-18", "2096-06-22"]);

      expect(data.openQuotations.awaitingDecision).toBeGreaterThanOrEqual(4);
      expect(data.openQuotations.drafts).toBeGreaterThanOrEqual(1);
      expect(data.expiringSoon.count).toBeGreaterThanOrEqual(3);

      const pending = new Map(data.pendingDeliveries.rows.map((r) => [r.id, r]));
      expect(pending.get(open.id)).toMatchObject({ status: "open", lineCount: 1, pendingLines: 1 });
      expect(pending.get(partial.id)).toMatchObject({ status: "partially_delivered", lineCount: 1, pendingLines: 1 });
      expect(pending.has(done.id)).toBe(false);
    });

    it("a cancelled challan puts its quantities back on the dashboard", async () => {
      const db = await getTestDb();
      const po = await order(await quote("2096-06-30", { approve: true }), "ZZDB-PO-CANCEL");
      const c = await createChallan(db, ownerId, { purchaseOrderId: po.id, challanDate: "2096-06-15", lines: [{ poLineId: po.poLineId, quantity: "10" }] }, NOW);
      expect((await getDashboardData(db, { now: NOW, limit: BIG })).pendingDeliveries.rows.some((r) => r.id === po.id)).toBe(false);
      await cancelChallan(db, ownerId, { id: c.id, reason: "wrong vehicle" }, NOW);
      const back = (await getDashboardData(db, { now: NOW, limit: BIG })).pendingDeliveries.rows.find((r) => r.id === po.id);
      expect(back).toMatchObject({ status: "open", pendingLines: 1 });
    });

    it("limits each list but keeps the full counts", async () => {
      const db = await getTestDb();
      const data = await getDashboardData(db, { now: NOW, limit: 1 });
      expect(data.openQuotations.rows).toHaveLength(1);
      expect(data.openQuotations.awaitingDecision).toBeGreaterThan(1);
      expect(data.expiringSoon.rows).toHaveLength(1);
      expect(data.pendingDeliveries.rows).toHaveLength(1);
      expect(data.pendingDeliveries.count).toBeGreaterThan(1);
    });
  });

  describe("audit log", () => {
    it("returns newest first with the actor's name, filters by type, action and date, and pages", async () => {
      const db = await getTestDb();
      const id = await quote("2096-06-30", { approve: true });

      const mine = await findAuditEntries(db, { entityId: id });
      expect(mine.rows.map((r) => `${r.action}:${r.fromStatus ?? ""}>${r.toStatus ?? ""}`)).toEqual(["status_change:sent>approved", "status_change:draft>sent", "create:>draft"]);
      expect(mine.rows[0]).toMatchObject({ userName: "ZZTEST db owner", entityType: "quotation" });

      const onlyCreates = await findAuditEntries(db, { entityId: id, action: "create" });
      expect(onlyCreates.rows).toHaveLength(1);
      const wrongType = await findAuditEntries(db, { entityId: id, entityType: "customer" });
      expect(wrongType.rows).toHaveLength(0);

      // Dates are India calendar days: the log rows were written just now, so today's range holds them and tomorrow's does not.
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      expect((await findAuditEntries(db, { entityId: id, from: today, to: today })).rows).toHaveLength(3);
      expect((await findAuditEntries(db, { entityId: id, from: tomorrow })).rows).toHaveLength(0);

      const page1 = await findAuditEntries(db, {});
      expect(page1.rows.length).toBeLessThanOrEqual(50);
      const options = await auditFilterOptions(db);
      expect(options.entityTypes).toContain("quotation");
      expect(options.actions).toContain("status_change");
    });
  });
});
