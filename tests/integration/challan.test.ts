import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  businessProfile,
  challanLine,
  customer,
  deliveryChallan,
  numberSeries,
  poLine,
  product,
  purchaseOrder,
  quotation,
  quotationLine,
  user,
} from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { getLineQuantities } from "@/lib/challan/pending";
import { DEFAULT_FORMATS } from "@/lib/numbering";
import { cancelChallan, createChallan, type ChallanInput } from "@/server/challan-core";
import { findChallans, getChallanDetail, listChallansForOrder } from "@/server/challan-queries";
import { recordPurchaseOrder } from "@/server/order-core";
import { approveQuotation, issueQuotation, saveDraft, type DraftInput } from "@/server/quotation-core";
import { closeTestDb, getTestDb, hasTestDb } from "./helpers";

// Needs the TEST database (see numbering.test.ts). Customers and products use the ZZCH prefix and numbering uses a
// financial year of its own (2098-99), so this file never touches real data or the other files' numbers.
const suite = hasTestDb() ? describe : describe.skip;
if (!hasTestDb()) {
  console.warn("[integration] SKIPPED challan.test.ts: TEST_DATABASE_URL is not set (see .env.example)");
}

const PREFIX = "ZZCH ";
const FY = "2098-99";
const NOW = new Date("2098-06-15T10:00:00+05:30");
const LATER = new Date("2098-06-17T10:00:00+05:30");
const TODAY = "2098-06-15";

let ownerId: string;
let salesId: string;
let otherSalesId: string;
let customerId: string;
let quotationId: string;
let createdBusinessProfile = false;

async function approvedQuotation() {
  const db = await getTestDb();
  const [c] = await db.select().from(customer).where(eq(customer.id, customerId));
  const [tile, sink] = await db.select().from(product).where(like(product.name, `${PREFIX}%`)).orderBy(product.name);
  const input: DraftInput = {
    customerId: c.id,
    quotationDate: TODAY,
    validUntil: "2098-06-30",
    billTo: { name: `${PREFIX}Radius 9 Innovations`, gstin: null, address: "Pune", stateCode: "27" },
    shipTo: { name: `${PREFIX}Radius 9 site`, address: "Baner, Pune", stateCode: "27", contactName: null, contactPhone: null },
    layout: "gst_quotation",
    terms: null,
    advanceAmount: "0",
    notes: null,
    lines: [
      { kind: "product", productId: tile.id, description: `${PREFIX}ATN 600X600 Plain Ivory`, hsnCode: "6907", unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", quantity: "100", rate: "580.00", discountPercent: "0", gstRate: "18" },
      { kind: "product", productId: sink.id, description: `${PREFIX}Sink 24 inch`, hsnCode: "6910", unit: "piece", piecesPerBox: null, sqftPerBox: null, quantity: "10", rate: "1200.00", discountPercent: "10", gstRate: "18" },
    ],
  };
  const { id } = await saveDraft(db, ownerId, input, NOW);
  await issueQuotation(db, ownerId, id, NOW);
  await approveQuotation(db, ownerId, id, NOW);
  return id;
}

let poCounter = 0;
/** A fresh PO of 100 boxes of tile (line 1) and, unless `sinks` is false, 10 sinks (line 2). Returns the PO id and its line ids. */
async function newPo({ boxes = "100", sinks = "10" }: { boxes?: string; sinks?: string | null } = {}) {
  const db = await getTestDb();
  const lines = (await db.select().from(quotationLine).innerJoin(quotation, eq(quotation.currentRevisionId, quotationLine.revisionId)).where(eq(quotation.id, quotationId)))
    .map((r) => r.quotation_line)
    .sort((a, b) => a.lineNo - b.lineNo);
  const { id } = await recordPurchaseOrder(
    db,
    salesId,
    {
      quotationId,
      customerPoNumber: `CH-PO-${Date.now()}-${++poCounter}`,
      poDate: TODAY,
      advanceReceived: "0",
      notes: null,
      lines: [{ quotationLineId: lines[0].id, quantity: boxes }, ...(sinks === null ? [] : [{ quotationLineId: lines[1].id, quantity: sinks }])],
    },
    NOW,
  );
  const poLines = await db.select().from(poLine).where(eq(poLine.purchaseOrderId, id)).orderBy(poLine.lineNo);
  return { id, tile: poLines[0].id, sink: poLines[1]?.id };
}

function challanInput(purchaseOrderId: string, lines: Array<[string, string]>, overrides: Partial<ChallanInput> = {}): ChallanInput {
  return { purchaseOrderId, challanDate: TODAY, lines: lines.map(([poLineId, quantity]) => ({ poLineId, quantity })), ...overrides };
}

async function pendingOf(orderId: string, poLineId: string) {
  const db = await getTestDb();
  const q = (await getLineQuantities(db, orderId)).find((l) => l.poLineId === poLineId)!;
  return { ordered: Number(q.ordered), delivered: Number(q.delivered), pending: Number(q.pending), excess: Number(q.excess) };
}

async function statusOf(orderId: string) {
  const db = await getTestDb();
  const [row] = await db.select({ status: purchaseOrder.status }).from(purchaseOrder).where(eq(purchaseOrder.id, orderId));
  return row.status;
}

async function auditFor(entityId: string) {
  const db = await getTestDb();
  return db.select().from(auditLog).where(eq(auditLog.entityId, entityId)).orderBy(auditLog.createdAt);
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
    // Challan lines go with the challan (cascade); challans must go before the PO and the PO before the quotation.
    await db.delete(deliveryChallan).where(inArray(deliveryChallan.customerId, ids));
    await db.delete(purchaseOrder).where(inArray(purchaseOrder.customerId, ids));
    await db.delete(quotation).where(inArray(quotation.customerId, ids));
    await db.delete(customer).where(inArray(customer.id, ids));
  }
  await db.delete(product).where(like(product.name, `${PREFIX}%`));
  await db.delete(user).where(like(user.email, "zztest-ch-%"));
  await db.delete(numberSeries).where(eq(numberSeries.financialYear, FY));
}

suite("delivery challans (real Postgres)", () => {
  beforeAll(async () => {
    await cleanup();
    const db = await getTestDb();
    // Integration files run in parallel and share the one business_profile row: insert only if nobody else just did.
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
    const stamp = Date.now();
    const [o, s, s2] = await db
      .insert(user)
      .values([
        { name: "ZZTEST ch owner", email: `zztest-ch-owner-${stamp}@example.test`, role: "owner" },
        { name: "ZZTEST ch sales", email: `zztest-ch-sales-${stamp}@example.test`, role: "sales" },
        { name: "ZZTEST ch sales two", email: `zztest-ch-sales2-${stamp}@example.test`, role: "sales" },
      ])
      .returning({ id: user.id });
    ownerId = o.id;
    salesId = s.id;
    otherSalesId = s2.id;
    const [c] = await db.insert(customer).values({ type: "company", displayName: `${PREFIX}Radius 9 Innovations`, stateCode: "27", addressLine1: "Pune" }).returning({ id: customer.id });
    customerId = c.id;
    await db.insert(product).values([
      { name: `${PREFIX}ATN 600X600 Plain Ivory`, unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", hsnCode: "6907", gstRate: "18", sellingPricePerUnit: "580.00" },
      { name: `${PREFIX}Sink 24 inch`, unit: "piece", hsnCode: "6910", gstRate: "18", sellingPricePerUnit: "1200.00" },
    ]);
    quotationId = await approvedQuotation();
  });

  afterAll(async () => {
    await cleanup();
    const db = await getTestDb();
    if (createdBusinessProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "ZZTEST Alpha Tiles"));
    await closeTestDb();
  });

  describe("partial deliveries (quickstart scenario 8)", () => {
    it("delivers 60 then 40 of 100: pending, status and numbers follow", async () => {
      const db = await getTestDb();
      const po = await newPo();
      expect(await statusOf(po.id)).toBe("open");
      expect(await pendingOf(po.id, po.tile)).toEqual({ ordered: 100, delivered: 0, pending: 100, excess: 0 });

      const first = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "60"]]), NOW);
      expect(first.number).toMatch(/^CH\/2098-99\/\d{4}$/);
      expect(await pendingOf(po.id, po.tile)).toEqual({ ordered: 100, delivered: 60, pending: 40, excess: 0 });
      expect(await pendingOf(po.id, po.sink)).toMatchObject({ delivered: 0, pending: 10 });
      expect(await statusOf(po.id)).toBe("partially_delivered");

      const second = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "40"]]), NOW);
      expect(await pendingOf(po.id, po.tile)).toEqual({ ordered: 100, delivered: 100, pending: 0, excess: 0 });
      // The sinks are still pending, so the PO is not fully delivered yet.
      expect(await statusOf(po.id)).toBe("partially_delivered");
      const third = await createChallan(db, salesId, challanInput(po.id, [[po.sink, "10"]]), NOW);
      expect(await statusOf(po.id)).toBe("delivered");

      // Numbers are sequential and distinct.
      const n = [first, second, third].map((c) => Number(c.number.split("/")[2]));
      expect(n[1]).toBe(n[0] + 1);
      expect(n[2]).toBe(n[1] + 1);
      expect((await listChallansForOrder(db, po.id)).map((c) => c.number)).toEqual([first.number, second.number, third.number]);
    });

    it("snapshots the buyer, consignee, item details and PO references on the challan", async () => {
      const db = await getTestDb();
      const po = await newPo();
      const { id } = await createChallan(
        db,
        salesId,
        challanInput(po.id, [[po.tile, "5"], [po.sink, "2"]], { vehicleNo: "MH12 AB 1234", driverName: "Ramesh", driverPhone: "9800000000", showPrices: true, destination: "Baner", dispatchedThrough: "Own vehicle" }),
        NOW,
      );
      const detail = await getChallanDetail(db, id);
      expect(detail).not.toBeNull();
      expect(detail!.challan).toMatchObject({
        status: "issued",
        purchaseOrderId: po.id,
        customerId,
        challanDate: TODAY,
        buyerName: `${PREFIX}Radius 9 Innovations`,
        buyerStateCode: "27",
        consigneeName: `${PREFIX}Radius 9 site`,
        consigneeAddress: "Baner, Pune",
        consigneeStateCode: "27",
        taxMode: "intra",
        vehicleNo: "MH12 AB 1234",
        driverName: "Ramesh",
        driverPhone: "9800000000",
        showPrices: true,
        destination: "Baner",
        dispatchedThrough: "Own vehicle",
        createdBy: salesId,
      });
      expect(detail!.challan.buyersOrderNoDate).toMatch(/^CH-PO-.* dt\. 15 Jun 2098$/);
      expect(detail!.challan.referenceNoDate).toMatch(/^QT\/2098-99\/\d{4} dt\. 15 Jun 2098$/);
      expect(detail!.lines.map((l) => [l.lineNo, l.description, l.hsnCode, l.unit, l.quantity, l.rate, l.discountPercent, l.gstRate])).toEqual([
        [1, `${PREFIX}ATN 600X600 Plain Ivory`, "6907", "box", "5.000", "580.00", "0.00", "18.00"],
        [2, `${PREFIX}Sink 24 inch`, "6910", "piece", "2.000", "1200.00", "10.00", "18.00"],
      ]);

      // A later change to the customer does not alter the challan (FR-031).
      await db.update(customer).set({ displayName: `${PREFIX}Renamed Ltd`, addressLine1: "Elsewhere" }).where(eq(customer.id, customerId));
      const after = await getChallanDetail(db, id);
      expect(after!.challan.buyerName).toBe(`${PREFIX}Radius 9 Innovations`);
      await db.update(customer).set({ displayName: `${PREFIX}Radius 9 Innovations`, addressLine1: "Pune" }).where(eq(customer.id, customerId));
    });

    it("lets the dispatch name another consignee and checks its GSTIN against the state", async () => {
      const db = await getTestDb();
      const po = await newPo();
      const consignee = { name: "Site B", address: "Wakad, Pune", gstin: "27ABYFA7430K1ZT", stateCode: "27" };
      const { id } = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "1"]], { consignee }), NOW);
      expect((await getChallanDetail(db, id))!.challan).toMatchObject({ consigneeName: "Site B", consigneeGstin: "27ABYFA7430K1ZT", consigneeAddress: "Wakad, Pune" });
      await expect(createChallan(db, salesId, challanInput(po.id, [[po.tile, "1"]], { consignee: { ...consignee, stateCode: "29" } }), NOW)).rejects.toThrow(/state/i);
    });
  });

  describe("over-delivery", () => {
    it("blocks 1 more once everything is delivered, and does not use up a number", async () => {
      const db = await getTestDb();
      const po = await newPo({ sinks: null });
      await createChallan(db, salesId, challanInput(po.id, [[po.tile, "60"]]), NOW);
      await createChallan(db, salesId, challanInput(po.id, [[po.tile, "40"]]), NOW);
      expect(await statusOf(po.id)).toBe("delivered");

      const before = await db.select({ n: numberSeries.lastValue }).from(numberSeries).where(and(eq(numberSeries.series, "challan"), eq(numberSeries.financialYear, FY)));
      const attempt = createChallan(db, salesId, challanInput(po.id, [[po.tile, "1"]]), NOW);
      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toThrow(/more than the 0 still pending/);
      const after = await db.select({ n: numberSeries.lastValue }).from(numberSeries).where(and(eq(numberSeries.series, "challan"), eq(numberSeries.financialYear, FY)));
      expect(after[0].n).toBe(before[0].n); // rolled back: the number was not consumed
      expect(await pendingOf(po.id, po.tile)).toMatchObject({ delivered: 100, pending: 0 });
      expect(await statusOf(po.id)).toBe("delivered");
    });

    it("blocks a partial excess too: 41 when 40 are pending", async () => {
      const db = await getTestDb();
      const po = await newPo({ sinks: null });
      await createChallan(db, salesId, challanInput(po.id, [[po.tile, "60"]]), NOW);
      await expect(createChallan(db, salesId, challanInput(po.id, [[po.tile, "41"]]), NOW)).rejects.toThrow(/more than the 40 still pending/);
      expect(await db.select().from(deliveryChallan).where(eq(deliveryChallan.purchaseOrderId, po.id))).toHaveLength(1);
    });

    it("sales cannot override, even with a reason", async () => {
      const db = await getTestDb();
      const po = await newPo({ sinks: null });
      const attempt = createChallan(db, salesId, challanInput(po.id, [[po.tile, "101"]], { overrideReason: "customer asked for extra" }), NOW);
      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toThrow(/Only the owner can deliver more than what is pending/);
      expect(await db.select().from(deliveryChallan).where(eq(deliveryChallan.purchaseOrderId, po.id))).toHaveLength(0);
    });

    it("an owner override needs a reason, is recorded, and shows as excess", async () => {
      const db = await getTestDb();
      const po = await newPo({ sinks: null });
      const noReason = createChallan(db, ownerId, challanInput(po.id, [[po.tile, "101"]]), NOW);
      await expect(noReason).rejects.toBeInstanceOf(ValidationError);
      await expect(noReason).rejects.toMatchObject({ fieldErrors: { overrideReason: expect.any(String) } });
      await expect(createChallan(db, ownerId, challanInput(po.id, [[po.tile, "101"]], { overrideReason: "   " }), NOW)).rejects.toBeInstanceOf(ValidationError);
      expect(await db.select().from(deliveryChallan).where(eq(deliveryChallan.purchaseOrderId, po.id))).toHaveLength(0);

      const { id } = await createChallan(db, ownerId, challanInput(po.id, [[po.tile, "101"]], { overrideReason: "Breakage allowance agreed on phone" }), NOW);
      expect(await pendingOf(po.id, po.tile)).toEqual({ ordered: 100, delivered: 101, pending: 0, excess: 1 });
      expect(await statusOf(po.id)).toBe("delivered");
      const [row] = await db.select().from(deliveryChallan).where(eq(deliveryChallan.id, id));
      expect(row.overrideReason).toBe("Breakage allowance agreed on phone");
      const audit = await auditFor(id);
      expect(audit.map((a) => a.action)).toEqual(["create", "override"]);
      expect(audit[1].note).toContain("Breakage allowance agreed on phone");
      expect(audit[1].userId).toBe(ownerId);
    });

    it("an owner supplying a reason without exceeding pending is a normal challan, not an override", async () => {
      const db = await getTestDb();
      const po = await newPo({ sinks: null });
      const { id } = await createChallan(db, ownerId, challanInput(po.id, [[po.tile, "10"]], { overrideReason: "not needed" }), NOW);
      expect((await auditFor(id)).map((a) => a.action)).toEqual(["create"]);
      const [row] = await db.select().from(deliveryChallan).where(eq(deliveryChallan.id, id));
      expect(row.overrideReason).toBeNull();
    });
  });

  describe("cancelling (quickstart scenario 8)", () => {
    it("restores pending, keeps the number and moves the PO status back", async () => {
      const db = await getTestDb();
      const po = await newPo({ sinks: null });
      const first = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "60"]]), NOW);
      const second = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "40"]]), NOW);
      expect(await statusOf(po.id)).toBe("delivered");

      await cancelChallan(db, salesId, { id: first.id, reason: "Wrong vehicle, goods not dispatched" }, NOW);
      expect(await pendingOf(po.id, po.tile)).toEqual({ ordered: 100, delivered: 40, pending: 60, excess: 0 });
      expect(await statusOf(po.id)).toBe("partially_delivered");

      // The record and its number are still there.
      const [row] = await db.select().from(deliveryChallan).where(eq(deliveryChallan.id, first.id));
      expect(row).toMatchObject({ number: first.number, status: "cancelled", cancelReason: "Wrong vehicle, goods not dispatched", cancelledBy: salesId });
      expect(row.cancelledAt).toBeInstanceOf(Date);
      expect(await db.select().from(challanLine).where(eq(challanLine.challanId, first.id))).toHaveLength(1);

      // The number is not reused: a new challan gets the next one.
      const third = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "60"]]), NOW);
      expect(Number(third.number.split("/")[2])).toBe(Number(second.number.split("/")[2]) + 1);
      expect(await statusOf(po.id)).toBe("delivered");

      // Cancelling everything takes the PO back to open.
      await cancelChallan(db, ownerId, { id: second.id, reason: "returned" }, NOW);
      await cancelChallan(db, ownerId, { id: third.id, reason: "returned" }, NOW);
      expect(await pendingOf(po.id, po.tile)).toMatchObject({ delivered: 0, pending: 100 });
      expect(await statusOf(po.id)).toBe("open");

      const audit = await auditFor(first.id);
      expect(audit.map((a) => [a.action, a.fromStatus, a.toStatus, a.note])).toEqual([
        ["create", null, "issued", expect.stringContaining(first.number)],
        ["status_change", "issued", "cancelled", "Wrong vehicle, goods not dispatched"],
      ]);
      const poAudit = (await auditFor(po.id)).filter((a) => a.action === "status_change").map((a) => `${a.fromStatus}>${a.toStatus}`);
      expect(poAudit).toEqual(["open>partially_delivered", "partially_delivered>delivered", "delivered>partially_delivered", "partially_delivered>delivered", "delivered>partially_delivered", "partially_delivered>open"]);
    });

    it("needs a reason, and an already cancelled or unknown challan is refused", async () => {
      const db = await getTestDb();
      const po = await newPo();
      const c = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "5"]]), NOW);
      await expect(cancelChallan(db, salesId, { id: c.id, reason: "  " }, NOW)).rejects.toBeInstanceOf(ValidationError);
      expect((await db.select().from(deliveryChallan).where(eq(deliveryChallan.id, c.id)))[0].status).toBe("issued");
      await cancelChallan(db, salesId, { id: c.id, reason: "duplicate entry" }, NOW);
      await expect(cancelChallan(db, salesId, { id: c.id, reason: "again" }, NOW)).rejects.toBeInstanceOf(ConflictError);
      await expect(cancelChallan(db, salesId, { id: crypto.randomUUID(), reason: "gone" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("sales may cancel their own challan on the same day only; the owner may cancel any", async () => {
      const db = await getTestDb();
      const po = await newPo();
      const mine = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "5"]]), NOW);
      const theirs = await createChallan(db, otherSalesId, challanInput(po.id, [[po.tile, "5"]]), NOW);
      const old = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "5"]]), NOW);

      await expect(cancelChallan(db, salesId, { id: theirs.id, reason: "not mine" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(cancelChallan(db, salesId, { id: old.id, reason: "too late" }, LATER)).rejects.toBeInstanceOf(ForbiddenError);
      await cancelChallan(db, salesId, { id: mine.id, reason: "my own mistake" }, NOW);
      await cancelChallan(db, ownerId, { id: theirs.id, reason: "owner decision" }, LATER);
      await cancelChallan(db, ownerId, { id: old.id, reason: "owner decision, later" }, LATER);
      expect(await pendingOf(po.id, po.tile)).toMatchObject({ delivered: 0, pending: 100 });
    });
  });

  describe("concurrency", () => {
    it("two simultaneous challans of 60 on 100 pending: exactly one succeeds", async () => {
      const db = await getTestDb();
      const po = await newPo({ sinks: null });
      const results = await Promise.allSettled([
        createChallan(db, salesId, challanInput(po.id, [[po.tile, "60"]]), NOW),
        createChallan(db, otherSalesId, challanInput(po.id, [[po.tile, "60"]]), NOW),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(ConflictError);
      expect(await pendingOf(po.id, po.tile)).toMatchObject({ delivered: 60, pending: 40 });
      expect(await statusOf(po.id)).toBe("partially_delivered");
    });

    it("five simultaneous challans of 30 on 100 pending: three go through, never more than 100 delivered, numbers gap-free", async () => {
      const db = await getTestDb();
      const po = await newPo({ sinks: null });
      const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => createChallan(db, i % 2 ? salesId : otherSalesId, challanInput(po.id, [[po.tile, "30"]]), NOW)));
      const ok = results.filter((r): r is PromiseFulfilledResult<{ id: string; number: string }> => r.status === "fulfilled");
      expect(ok).toHaveLength(3);
      expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof ConflictError)).toBe(true);
      expect(await pendingOf(po.id, po.tile)).toMatchObject({ delivered: 90, pending: 10 });
      const numbers = ok.map((r) => Number(r.value.number.split("/")[2])).sort((a, b) => a - b);
      expect(numbers[1]).toBe(numbers[0] + 1);
      expect(numbers[2]).toBe(numbers[1] + 1);
    });

    it("a challan racing a cancel of an earlier one sees the pending the cancel frees, in one order or the other", async () => {
      const db = await getTestDb();
      const po = await newPo({ sinks: null });
      const first = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "100"]]), NOW);
      const [created, cancelled] = await Promise.allSettled([
        createChallan(db, salesId, challanInput(po.id, [[po.tile, "100"]]), NOW),
        cancelChallan(db, salesId, { id: first.id, reason: "redo" }, NOW),
      ]);
      expect(cancelled.status).toBe("fulfilled");
      // Either the new challan ran after the cancel (and went through) or before it (and was blocked): never both delivered.
      const delivered = (await pendingOf(po.id, po.tile)).delivered;
      expect(created.status === "fulfilled" ? delivered === 100 : delivered === 0).toBe(true);
    });
  });

  describe("input rules", () => {
    it("refuses an empty challan, zero or fractional quantities, repeated and foreign lines", async () => {
      const db = await getTestDb();
      const po = await newPo();
      const other = await newPo();
      const make = (lines: Array<[string, string]>, o: Partial<ChallanInput> = {}) => createChallan(db, salesId, challanInput(po.id, lines, o), NOW);
      await expect(createChallan(db, salesId, { purchaseOrderId: po.id, challanDate: TODAY, lines: [] }, NOW)).rejects.toThrow(/at least one item/);
      await expect(make([[po.tile, "0"]])).rejects.toThrow(/more than zero/);
      await expect(make([[po.tile, "-3"]])).rejects.toBeInstanceOf(ValidationError);
      await expect(make([[po.tile, "2.5"]])).rejects.toThrow(/whole number of boxes/);
      await expect(make([[po.tile, "1"], [po.tile, "1"]])).rejects.toThrow(/more than once/);
      await expect(make([[other.tile, "1"]])).rejects.toThrow(/not on this PO/);
      expect(await db.select().from(deliveryChallan).where(eq(deliveryChallan.purchaseOrderId, po.id))).toHaveLength(0);
    });

    it("checks the date: not in the future, not before the PO", async () => {
      const db = await getTestDb();
      const po = await newPo();
      await expect(createChallan(db, salesId, challanInput(po.id, [[po.tile, "1"]], { challanDate: "2098-06-16" }), NOW)).rejects.toThrow(/future/);
      await expect(createChallan(db, salesId, challanInput(po.id, [[po.tile, "1"]], { challanDate: "2098-06-14" }), NOW)).rejects.toThrow(/before the PO date/);
    });

    it("refuses a challan on a cancelled PO and on an unknown PO; refuses an inactive or unknown user", async () => {
      const db = await getTestDb();
      const po = await newPo();
      await db.update(purchaseOrder).set({ status: "cancelled" }).where(eq(purchaseOrder.id, po.id));
      await expect(createChallan(db, salesId, challanInput(po.id, [[po.tile, "1"]]), NOW)).rejects.toThrow(/cancelled/);
      await expect(createChallan(db, salesId, challanInput(crypto.randomUUID(), [[po.tile, "1"]]), NOW)).rejects.toBeInstanceOf(NotFoundError);
      const live = await newPo();
      await expect(createChallan(db, crypto.randomUUID(), challanInput(live.id, [[live.tile, "1"]]), NOW)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("reading challans", () => {
    it("finds challans by customer, number, PO number, status and date", async () => {
      const db = await getTestDb();
      const po = await newPo({ sinks: null });
      const a = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "3"]]), NOW);
      const b = await createChallan(db, salesId, challanInput(po.id, [[po.tile, "4"]]), NOW);
      await cancelChallan(db, salesId, { id: b.id, reason: "wrong qty" }, NOW);
      const [order] = await db.select().from(purchaseOrder).where(eq(purchaseOrder.id, po.id));

      const byPo = await findChallans(db, { poNumber: order.customerPoNumber });
      expect(byPo.map((r) => r.number).sort()).toEqual([a.number, b.number].sort());
      expect((await findChallans(db, { number: a.number })).map((r) => r.id)).toEqual([a.id]);
      expect((await findChallans(db, { poNumber: order.customerPoNumber, status: "cancelled" })).map((r) => r.id)).toEqual([b.id]);
      expect((await findChallans(db, { customer: `${PREFIX}Radius`, from: TODAY, to: TODAY })).length).toBeGreaterThanOrEqual(2);
      expect(await findChallans(db, { customer: `${PREFIX}Radius`, from: "2098-06-16" })).toHaveLength(0);
      expect(await getChallanDetail(db, crypto.randomUUID())).toBeNull();
    });
  });
});
