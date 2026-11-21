import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  businessProfile,
  customer,
  file,
  numberSeries,
  poFile,
  poLine,
  product,
  purchaseOrder,
  quotation,
  quotationLine,
  user,
} from "@/db/schema";
import { ConflictError, ValidationError } from "@/lib/errors";
import { DEFAULT_FORMATS } from "@/lib/numbering";
import {
  approveQuotation,
  issueQuotation,
  rejectQuotation,
  reinstateQuotation,
  saveDraft,
  type DraftInput,
} from "@/server/quotation-core";
import { DuplicatePurchaseOrderError, recordPurchaseOrder, type PurchaseOrderInput } from "@/server/order-core";
import { findPurchaseOrders, getPurchaseOrderDetail, listPurchaseOrdersForQuotation } from "@/server/order-queries";
import { closeTestDb, getTestDb, hasTestDb } from "./helpers";

// Needs the TEST database (see numbering.test.ts). Customers and products use the ZZPO prefix and numbering uses a
// financial year of its own (2094-95), so this file never touches real data or the other files' numbers.
const suite = hasTestDb() ? describe : describe.skip;
if (!hasTestDb()) {
  console.warn("[integration] SKIPPED purchase-order.test.ts: TEST_DATABASE_URL is not set (see .env.example)");
}

const PREFIX = "ZZPO ";
const FY = "2094-95";
const NOW = new Date("2094-06-15T10:00:00+05:30");
const TODAY = "2094-06-15";
const AFTER_EXPIRY = new Date("2094-07-20T10:00:00+05:30");

let actorId: string;
let customerId: string;
let otherCustomerId: string;
let tileProductId: string;
let sinkProductId: string;
let createdBusinessProfile = false;

function draftInput(overrides: Partial<DraftInput> = {}, forCustomer = customerId): DraftInput {
  return {
    customerId: forCustomer,
    quotationDate: TODAY,
    validUntil: "2094-06-30",
    billTo: { name: `${PREFIX}Radius 9 Innovations`, gstin: null, address: "Pune", stateCode: "27" },
    shipTo: { name: `${PREFIX}Radius 9 site`, address: "Baner, Pune", stateCode: "27", contactName: null, contactPhone: null },
    layout: "gst_quotation",
    terms: "Payment 100% Advance.",
    advanceAmount: "0",
    notes: null,
    lines: [
      {
        kind: "product", productId: tileProductId, description: "ATN 600X600 8538 Plain Ivory Matt", hsnCode: "6907", unit: "box",
        piecesPerBox: 4, sqftPerBox: "15.50", quantity: "4", rate: "580.00", discountPercent: "0", gstRate: "18",
      },
      {
        kind: "product", productId: sinkProductId, description: "Sink 24 inch", hsnCode: "6910", unit: "piece",
        piecesPerBox: null, sqftPerBox: null, quantity: "10", rate: "1200.00", discountPercent: "10", gstRate: "18",
      },
      {
        kind: "charge", chargeTypeId: null, description: "Transport Charges", hsnCode: "8704", unit: "piece",
        quantity: "1", rate: "550.00", discountPercent: "0", gstRate: "18",
      },
    ],
    ...overrides,
  };
}

/** A quotation moved to the given stored/derived state. */
async function quotationIn(state: "draft" | "sent" | "approved" | "rejected" | "expired", forCustomer = customerId) {
  const db = await getTestDb();
  const { id } = await saveDraft(db, actorId, draftInput({}, forCustomer), NOW);
  if (state === "draft") return id;
  await issueQuotation(db, actorId, id, NOW);
  if (state === "sent" || state === "expired") return id;
  if (state === "approved") await approveQuotation(db, actorId, id, NOW);
  if (state === "rejected") await rejectQuotation(db, actorId, id, "chose another supplier", NOW);
  return id;
}

async function linesOf(quotationId: string) {
  const db = await getTestDb();
  const [q] = await db.select({ rev: quotation.currentRevisionId }).from(quotation).where(eq(quotation.id, quotationId));
  return db.select().from(quotationLine).where(eq(quotationLine.revisionId, q.rev!)).orderBy(quotationLine.lineNo);
}

/** A PO input for the quotation: every product line at the quoted quantity unless `quantities` says otherwise. */
async function poInput(quotationId: string, overrides: Partial<PurchaseOrderInput> & { quantities?: Record<number, string> } = {}): Promise<PurchaseOrderInput> {
  const { quantities = {}, ...rest } = overrides;
  const lines = (await linesOf(quotationId)).filter((l) => l.kind === "product");
  return {
    quotationId,
    customerPoNumber: `PO-${Math.random().toString(36).slice(2, 8)}`,
    poDate: TODAY,
    advanceReceived: "0",
    notes: null,
    lines: lines.map((l) => ({ quotationLineId: l.id, quantity: quantities[l.lineNo] ?? l.quantity })),
    ...rest,
  };
}

async function storedFile(name: string) {
  const db = await getTestDb();
  const [row] = await db
    .insert(file)
    .values({ storageKey: `zzpo-test/${crypto.randomUUID()}/${name}`, originalName: name, mimeType: "application/pdf", size: 1234, uploadedBy: actorId })
    .returning({ id: file.id });
  return row.id;
}

async function cleanup() {
  const db = await getTestDb();
  const customers = await db.select({ id: customer.id }).from(customer).where(like(customer.displayName, `${PREFIX}%`));
  if (customers.length) {
    const ids = customers.map((c) => c.id);
    const pos = await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(inArray(purchaseOrder.customerId, ids));
    const quotes = await db.select({ id: quotation.id }).from(quotation).where(inArray(quotation.customerId, ids));
    const entityIds = [...pos.map((p) => p.id), ...quotes.map((q) => q.id)];
    if (entityIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, entityIds));
    // Lines and file links go with the PO (cascade); the PO must go before the quotation it references.
    await db.delete(purchaseOrder).where(inArray(purchaseOrder.customerId, ids));
    await db.delete(quotation).where(inArray(quotation.customerId, ids));
    await db.delete(customer).where(inArray(customer.id, ids));
  }
  await db.delete(file).where(like(file.storageKey, "zzpo-test/%"));
  await db.delete(product).where(like(product.name, `${PREFIX}%`));
  await db.delete(user).where(like(user.email, "zztest-po-%"));
  await db.delete(numberSeries).where(eq(numberSeries.financialYear, FY));
}

suite("purchase orders (real Postgres)", () => {
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
    await db.insert(numberSeries).values({ series: "quotation", financialYear: FY, format: DEFAULT_FORMATS.quotation, lastValue: 0 });
    const [u] = await db.insert(user).values({ name: "ZZTEST po staff", email: `zztest-po-${Date.now()}@example.test`, role: "sales" }).returning({ id: user.id });
    actorId = u.id;
    const [c1, c2] = await db
      .insert(customer)
      .values([
        { type: "company", displayName: `${PREFIX}Radius 9 Innovations`, stateCode: "27" },
        { type: "company", displayName: `${PREFIX}Pune Builders`, stateCode: "27" },
      ])
      .returning({ id: customer.id });
    customerId = c1.id;
    otherCustomerId = c2.id;
    const [p1, p2] = await db
      .insert(product)
      .values([
        { name: `${PREFIX}ATN 600X600 8538 Plain Ivory Matt`, unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", hsnCode: "6907", gstRate: "18", sellingPricePerUnit: "580.00" },
        { name: `${PREFIX}Sink 24 inch`, unit: "piece", hsnCode: "6910", gstRate: "18", sellingPricePerUnit: "1200.00" },
      ])
      .returning({ id: product.id });
    tileProductId = p1.id;
    sinkProductId = p2.id;
  });

  afterAll(async () => {
    await cleanup();
    const db = await getTestDb();
    if (createdBusinessProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "ZZTEST Alpha Tiles"));
    await closeTestDb();
  });

  describe("only an approved quotation takes a PO", () => {
    it("records a PO against an approved quotation, linked to it, its revision and the customer", async () => {
      const db = await getTestDb();
      const qid = await quotationIn("approved");
      const { id } = await recordPurchaseOrder(db, actorId, await poInput(qid, { customerPoNumber: "PO/LINK/1", advanceReceived: "5000.50", notes: "Deliver after 1st" }), NOW);
      const detail = await getPurchaseOrderDetail(db, id);
      expect(detail).not.toBeNull();
      const [q] = await db.select().from(quotation).where(eq(quotation.id, qid));
      expect(detail!.order).toMatchObject({
        quotationId: qid,
        quotationRevisionId: q.currentRevisionId,
        customerId,
        customerPoNumber: "PO/LINK/1",
        poDate: TODAY,
        advanceReceived: "5000.50",
        notes: "Deliver after 1st",
        status: "open",
        createdBy: actorId,
      });
      expect(detail!.quotationNumber).toBe(q.number);
      const listed = await listPurchaseOrdersForQuotation(db, qid);
      expect(listed.map((p) => p.id)).toEqual([id]);
    });

    it.each(["draft", "sent", "rejected", "expired"] as const)("refuses a PO on a %s quotation and records nothing", async (state) => {
      const db = await getTestDb();
      const qid = await quotationIn(state);
      const input = await poInput(qid);
      const attempt = recordPurchaseOrder(db, actorId, input, state === "expired" ? AFTER_EXPIRY : NOW);
      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      expect(await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(eq(purchaseOrder.quotationId, qid))).toHaveLength(0);
    });

    it("tells the person to reinstate a rejected or expired quotation first", async () => {
      const db = await getTestDb();
      const rejected = await quotationIn("rejected");
      await expect(recordPurchaseOrder(db, actorId, await poInput(rejected), NOW)).rejects.toThrow(/reinstate/i);
      const expired = await quotationIn("expired");
      await expect(recordPurchaseOrder(db, actorId, await poInput(expired), AFTER_EXPIRY)).rejects.toThrow(/expired.*reinstate|reinstate.*expired/i);
    });

    it("works once a rejected quotation is reinstated and approved", async () => {
      const db = await getTestDb();
      const qid = await quotationIn("rejected");
      await reinstateQuotation(db, actorId, qid, { note: "customer came back" }, NOW);
      await approveQuotation(db, actorId, qid, NOW);
      await expect(recordPurchaseOrder(db, actorId, await poInput(qid), NOW)).resolves.toMatchObject({ id: expect.any(String) });
    });

    it("refuses an unknown quotation", async () => {
      const db = await getTestDb();
      const input = await poInput(await quotationIn("approved"), { quotationId: crypto.randomUUID() });
      await expect(recordPurchaseOrder(db, actorId, input, NOW)).rejects.toThrow(/no longer exists/i);
    });

    it("allows more than one PO against the same quotation", async () => {
      const db = await getTestDb();
      const qid = await quotationIn("approved");
      await recordPurchaseOrder(db, actorId, await poInput(qid, { customerPoNumber: "PO/TWO/A" }), NOW);
      await recordPurchaseOrder(db, actorId, await poInput(qid, { customerPoNumber: "PO/TWO/B" }), NOW);
      expect(await listPurchaseOrdersForQuotation(db, qid)).toHaveLength(2);
    });
  });

  describe("ordered lines", () => {
    it("ordered quantity may differ from quoted; a line left out is simply not ordered; charges are not PO lines", async () => {
      const db = await getTestDb();
      const qid = await quotationIn("approved");
      const quoted = (await linesOf(qid)).filter((l) => l.kind === "product");
      // Tiles: 3 boxes instead of 4. Sinks: not ordered at all.
      const input: PurchaseOrderInput = {
        ...(await poInput(qid)),
        lines: [{ quotationLineId: quoted[0].id, quantity: "3" }],
      };
      const { id } = await recordPurchaseOrder(db, actorId, input, NOW);
      const detail = (await getPurchaseOrderDetail(db, id))!;
      expect(detail.lines).toHaveLength(1);
      expect(detail.lines[0]).toMatchObject({ quantityOrdered: "3.000", quantityQuoted: "4.000", quotationLineId: quoted[0].id });
      // The quotation lines the PO does not carry are listed so the difference is visible.
      expect(detail.notOrdered.map((l) => l.description)).toEqual(["Sink 24 inch"]);
      // Ordered value follows the PO quantity: 3 x 580 = 1,740 taxable, 18% = 313.20.
      expect(detail.value).toMatchObject({ taxable: "1740.00", tax: "313.20", total: "2053.20" });
    });

    it("may order more than was quoted", async () => {
      const db = await getTestDb();
      const qid = await quotationIn("approved");
      const { id } = await recordPurchaseOrder(db, actorId, await poInput(qid, { quantities: { 1: "6" } }), NOW);
      const detail = (await getPurchaseOrderDetail(db, id))!;
      expect(detail.lines[0]).toMatchObject({ quantityOrdered: "6.000", quantityQuoted: "4.000" });
    });

    it("snapshots description, HSN, unit, rate, discount and GST from the quotation line", async () => {
      const db = await getTestDb();
      const qid = await quotationIn("approved");
      const { id } = await recordPurchaseOrder(db, actorId, await poInput(qid), NOW);
      const expected = [
        { lineNo: 1, description: "ATN 600X600 8538 Plain Ivory Matt", hsnCode: "6907", unit: "box", rate: "580.00", discountPercent: "0.00", gstRate: "18.00" },
        { lineNo: 2, description: "Sink 24 inch", hsnCode: "6910", unit: "piece", rate: "1200.00", discountPercent: "10.00", gstRate: "18.00" },
      ];
      const lines = await db.select().from(poLine).where(eq(poLine.purchaseOrderId, id)).orderBy(poLine.lineNo);
      expect(lines.map(({ lineNo, description, hsnCode, unit, rate, discountPercent, gstRate }) => ({ lineNo, description, hsnCode, unit, rate, discountPercent, gstRate }))).toEqual(expected);

      // Whatever happens to the quotation line or the catalog later, the PO keeps what it recorded.
      await db.update(quotationLine).set({ description: "Changed", rate: "1.00", hsnCode: "0000", gstRate: "5" }).where(eq(quotationLine.id, lines[0].quotationLineId!));
      await db.update(product).set({ name: `${PREFIX}Renamed tile`, sellingPricePerUnit: "999.00" }).where(eq(product.id, tileProductId));
      const after = await db.select().from(poLine).where(eq(poLine.purchaseOrderId, id)).orderBy(poLine.lineNo);
      expect(after[0]).toMatchObject({ description: "ATN 600X600 8538 Plain Ivory Matt", hsnCode: "6907", rate: "580.00", gstRate: "18.00" });
      await db.update(product).set({ name: `${PREFIX}ATN 600X600 8538 Plain Ivory Matt`, sellingPricePerUnit: "580.00" }).where(eq(product.id, tileProductId));
    });

    it("rejects bad lines with a message the person can act on", async () => {
      const db = await getTestDb();
      const qid = await quotationIn("approved");
      const base = await poInput(qid);
      const [first] = base.lines;
      const attempts: [Partial<PurchaseOrderInput>, RegExp][] = [
        [{ lines: [] }, /at least one/i],
        [{ lines: [{ ...first, quantity: "0" }] }, /more than zero/i],
        [{ lines: [{ ...first, quantity: "-2" }] }, /number/i],
        [{ lines: [{ ...first, quantity: "2.5" }] }, /whole number of boxes/i],
        [{ lines: [first, first] }, /more than once/i],
        [{ lines: [{ quotationLineId: crypto.randomUUID(), quantity: "1" }] }, /not on this quotation/i],
        [{ advanceReceived: "-1" }, /advance/i],
        [{ customerPoNumber: "   " }, /PO number/i],
        [{ poDate: "15/06/2096" }, /date/i],
        [{ fileIds: [crypto.randomUUID()] }, /attachment/i],
      ];
      for (const [patch, message] of attempts) {
        await expect(recordPurchaseOrder(db, actorId, { ...base, ...patch }, NOW), JSON.stringify(patch)).rejects.toThrow(message);
        await expect(recordPurchaseOrder(db, actorId, { ...base, ...patch }, NOW)).rejects.toBeInstanceOf(ValidationError);
      }
      expect(await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(eq(purchaseOrder.quotationId, qid))).toHaveLength(0);
    });

    it("a charge line cannot be ordered, and a line of another quotation is refused", async () => {
      const db = await getTestDb();
      const qid = await quotationIn("approved");
      const other = await quotationIn("approved");
      const charge = (await linesOf(qid)).find((l) => l.kind === "charge")!;
      const foreign = (await linesOf(other))[0];
      const base = await poInput(qid);
      await expect(recordPurchaseOrder(db, actorId, { ...base, lines: [{ quotationLineId: charge.id, quantity: "1" }] }, NOW)).rejects.toThrow(/not on this quotation|charge/i);
      await expect(recordPurchaseOrder(db, actorId, { ...base, lines: [{ quotationLineId: foreign.id, quantity: "1" }] }, NOW)).rejects.toThrow(/not on this quotation/i);
    });
  });

  describe("duplicate customer PO numbers", () => {
    it("refuses the same number for the same customer until the duplicate is confirmed, and audits the override", async () => {
      const db = await getTestDb();
      const first = await quotationIn("approved");
      const second = await quotationIn("approved");
      const { id: firstId } = await recordPurchaseOrder(db, actorId, await poInput(first, { customerPoNumber: "PO/DUP/1" }), NOW);

      const clash = recordPurchaseOrder(db, actorId, await poInput(second, { customerPoNumber: "PO/DUP/1" }), NOW);
      await expect(clash).rejects.toBeInstanceOf(DuplicatePurchaseOrderError);
      await expect(clash).rejects.toMatchObject({ existingId: firstId });
      expect(await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(eq(purchaseOrder.quotationId, second))).toHaveLength(0);

      const { id: secondId } = await recordPurchaseOrder(db, actorId, await poInput(second, { customerPoNumber: "PO/DUP/1", confirmDuplicate: true }), NOW);
      expect(secondId).not.toBe(firstId);
      const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityType, "purchase_order"), eq(auditLog.entityId, secondId)));
      const override = audit.find((a) => a.action === "override");
      expect(override).toBeDefined();
      expect(override!.userId).toBe(actorId);
      expect(override!.note).toMatch(/duplicate/i);
      expect(override!.note).toContain("PO/DUP/1");
    });

    it("ignores case and surrounding spaces when comparing numbers", async () => {
      const db = await getTestDb();
      const first = await quotationIn("approved");
      const second = await quotationIn("approved");
      await recordPurchaseOrder(db, actorId, await poInput(first, { customerPoNumber: "po/dup/2" }), NOW);
      await expect(recordPurchaseOrder(db, actorId, await poInput(second, { customerPoNumber: "  PO/DUP/2 " }), NOW)).rejects.toBeInstanceOf(DuplicatePurchaseOrderError);
    });

    it("the same number for a different customer is not a duplicate", async () => {
      const db = await getTestDb();
      const mine = await quotationIn("approved");
      const theirs = await quotationIn("approved", otherCustomerId);
      await recordPurchaseOrder(db, actorId, await poInput(mine, { customerPoNumber: "PO/SHARED/1" }), NOW);
      await expect(recordPurchaseOrder(db, actorId, await poInput(theirs, { customerPoNumber: "PO/SHARED/1" }), NOW)).resolves.toMatchObject({ id: expect.any(String) });
    });

    it("two simultaneous submissions of one number record exactly one PO", async () => {
      const db = await getTestDb();
      const first = await quotationIn("approved");
      const second = await quotationIn("approved");
      const results = await Promise.allSettled([
        recordPurchaseOrder(db, actorId, await poInput(first, { customerPoNumber: "PO/RACE/1" }), NOW),
        recordPurchaseOrder(db, actorId, await poInput(second, { customerPoNumber: "PO/RACE/1" }), NOW),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(DuplicatePurchaseOrderError);
    });
  });

  describe("attachments, audit and queries", () => {
    it("links the attached files to the PO", async () => {
      const db = await getTestDb();
      const qid = await quotationIn("approved");
      const f1 = await storedFile("po-scan.pdf");
      const f2 = await storedFile("po-page-2.pdf");
      const { id } = await recordPurchaseOrder(db, actorId, await poInput(qid, { fileIds: [f1, f2] }), NOW);
      const links = await db.select().from(poFile).where(eq(poFile.purchaseOrderId, id));
      expect(links.map((l) => l.fileId).sort()).toEqual([f1, f2].sort());
      const detail = (await getPurchaseOrderDetail(db, id))!;
      expect(detail.files.map((f) => f.originalName).sort()).toEqual(["po-page-2.pdf", "po-scan.pdf"]);
    });

    it("a PO needs no attachment", async () => {
      const db = await getTestDb();
      const { id } = await recordPurchaseOrder(db, actorId, await poInput(await quotationIn("approved")), NOW);
      expect((await getPurchaseOrderDetail(db, id))!.files).toEqual([]);
    });

    it("audits who recorded the PO", async () => {
      const db = await getTestDb();
      const { id } = await recordPurchaseOrder(db, actorId, await poInput(await quotationIn("approved"), { customerPoNumber: "PO/AUDIT/1" }), NOW);
      const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityType, "purchase_order"), eq(auditLog.entityId, id)));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "create", toStatus: "open", userId: actorId });
      expect(audit[0].note).toContain("PO/AUDIT/1");
    });

    it("finds POs by customer, PO number, quotation number and date", async () => {
      const db = await getTestDb();
      const qid = await quotationIn("approved", otherCustomerId);
      const { id } = await recordPurchaseOrder(db, actorId, await poInput(qid, { customerPoNumber: "PO/FIND/77", poDate: "2094-06-10" }), NOW);
      const [q] = await db.select({ number: quotation.number }).from(quotation).where(eq(quotation.id, qid));
      const ids = async (f: Parameters<typeof findPurchaseOrders>[1]) => (await findPurchaseOrders(db, f)).map((r) => r.id);
      expect(await ids({ customer: "ZZPO Pune" })).toContain(id);
      expect(await ids({ poNumber: "find/77" })).toEqual([id]);
      expect(await ids({ quotationNumber: q.number! })).toEqual([id]);
      expect(await ids({ poNumber: "find/77", from: "2094-06-11" })).toEqual([]);
      expect(await ids({ poNumber: "find/77", to: "2094-06-10" })).toEqual([id]);
      expect(await ids({ poNumber: "find/77", status: "delivered" })).toEqual([]);
      const row = (await findPurchaseOrders(db, { poNumber: "find/77" }))[0];
      expect(row).toMatchObject({ customerName: `${PREFIX}Pune Builders`, quotationNumber: q.number, status: "open" });
    });
  });
});
