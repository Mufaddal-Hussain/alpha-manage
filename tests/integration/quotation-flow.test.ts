import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  businessProfile,
  chargeType,
  customer,
  numberSeries,
  product,
  quotation,
  user,
} from "@/db/schema";
import { DEFAULT_FORMATS } from "@/lib/numbering";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { effectiveStatus } from "@/lib/quotation/status";
import {
  approveQuotation,
  deleteDraft,
  duplicateQuotation,
  issueQuotation,
  rejectQuotation,
  reinstateQuotation,
  reviseQuotation,
  saveDraft,
  sendQuotation,
  type DraftInput,
} from "@/server/quotation-core";
import { getQuotationDetail } from "@/server/quotation-queries";
import { closeTestDb, getTestDb, hasTestDb } from "./helpers";

// Needs the TEST database (see numbering.test.ts). Everything created here uses a ZZTEST prefix or a financial
// year in the 2090s, and is removed afterwards, so it never touches real data or the real numbering.
const suite = hasTestDb() ? describe : describe.skip;
if (!hasTestDb()) {
  console.warn("[integration] SKIPPED quotation-flow.test.ts: TEST_DATABASE_URL is not set (see .env.example)");
}

const PREFIX = "ZZQTFLOW ";
const FY = "2097-98";
const NOW = new Date("2097-06-15T10:00:00+05:30");
const TODAY = "2097-06-15";
const AFTER_EXPIRY = new Date("2097-07-20T10:00:00+05:30");

let actorId: string;
let customerId: string;
let interStateCustomerId: string;
let tileProductId: string;
let transportTypeId: string;
let createdBusinessProfile = false;

const lineTile = (extra: Partial<DraftInput["lines"][number]> = {}): DraftInput["lines"][number] => ({
  kind: "product",
  productId: tileProductId,
  description: "ATN 600X600 8538 Plain Ivory Matt",
  hsnCode: "6907",
  unit: "box",
  piecesPerBox: 4,
  sqftPerBox: "15.50",
  quantity: "4",
  rate: "580.00",
  discountPercent: "0",
  gstRate: "18",
  ...extra,
});

const lineTransport = (): DraftInput["lines"][number] => ({
  kind: "charge",
  chargeTypeId: transportTypeId,
  description: "Transport Charges",
  hsnCode: "8704",
  unit: "piece",
  quantity: "1",
  rate: "550.00",
  discountPercent: "0",
  gstRate: "18",
});

function draftInput(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    customerId,
    quotationDate: TODAY,
    validUntil: "2097-06-30",
    billTo: { name: `${PREFIX}Radius 9 Innovations`, gstin: null, address: "Pune", stateCode: "27" },
    shipTo: { name: `${PREFIX}Radius 9 site`, address: "Baner, Pune", stateCode: "27", contactName: "Site contact", contactPhone: "9822000000" },
    layout: "gst_quotation",
    terms: "Payment 100% Advance.",
    advanceAmount: "0",
    notes: null,
    lines: [lineTile(), lineTransport()],
    ...overrides,
  };
}

async function newDraft(overrides: Partial<DraftInput> = {}) {
  const db = await getTestDb();
  return saveDraft(db, actorId, draftInput(overrides), NOW);
}

async function cleanup() {
  const db = await getTestDb();
  const customers = await db.select({ id: customer.id }).from(customer).where(like(customer.displayName, `${PREFIX}%`));
  if (customers.length) {
    const quotes = await db
      .select({ id: quotation.id })
      .from(quotation)
      .where(inArray(quotation.customerId, customers.map((c) => c.id)));
    if (quotes.length) {
      await db.delete(auditLog).where(and(eq(auditLog.entityType, "quotation"), inArray(auditLog.entityId, quotes.map((q) => q.id))));
    }
    // Revisions and lines go with the quotation (cascade).
    await db.delete(quotation).where(inArray(quotation.customerId, customers.map((c) => c.id)));
    await db.delete(customer).where(like(customer.displayName, `${PREFIX}%`));
  }
  await db.delete(product).where(like(product.name, `${PREFIX}%`));
  await db.delete(chargeType).where(like(chargeType.name, `${PREFIX}%`));
  await db.delete(user).where(like(user.email, "zztest-quotation-%"));
  await db.delete(numberSeries).where(eq(numberSeries.financialYear, FY));
}

suite("quotation flow (real Postgres)", () => {
  beforeAll(async () => {
    await cleanup();
    const db = await getTestDb();
    // The business state code drives intra/inter-state tax.
    const inserted = await db
      .insert(businessProfile)
      .values({ legalName: "ZZTEST Alpha Tiles", addressLine1: "Shop 4", city: "Pune", state: "Maharashtra", stateCode: "27" })
      .onConflictDoNothing() // test files run in parallel and share the one business_profile row
      .returning({ id: businessProfile.id });
    createdBusinessProfile = inserted.length > 0;
    // Own series row with the default format, so another test's edited format can never leak into these numbers.
    await db.insert(numberSeries).values({ series: "quotation", financialYear: FY, format: DEFAULT_FORMATS.quotation, lastValue: 0 });
    const [u] = await db
      .insert(user)
      .values({ name: "ZZTEST staff", email: `zztest-quotation-${Date.now()}@example.test`, role: "sales" })
      .returning({ id: user.id });
    actorId = u.id;
    const [c1] = await db
      .insert(customer)
      .values({ type: "company", displayName: `${PREFIX}Radius 9 Innovations`, stateCode: "27" })
      .returning({ id: customer.id });
    customerId = c1.id;
    const [c2] = await db
      .insert(customer)
      .values({ type: "company", displayName: `${PREFIX}Jaipur Traders`, stateCode: "08" })
      .returning({ id: customer.id });
    interStateCustomerId = c2.id;
    const [p] = await db
      .insert(product)
      .values({
        name: `${PREFIX}ATN 600X600 8538 Plain Ivory Matt`, unit: "box", piecesPerBox: 4, sqftPerBox: "15.50",
        hsnCode: "6907", gstRate: "18", sellingPricePerUnit: "580.00",
      })
      .returning({ id: product.id });
    tileProductId = p.id;
    const [t] = await db
      .insert(chargeType)
      .values({ name: `${PREFIX}Transport Charges`, hsnSacCode: "8704", gstRate: "18" })
      .returning({ id: chargeType.id });
    transportTypeId = t.id;
  });

  afterAll(async () => {
    await cleanup();
    const db = await getTestDb();
    if (createdBusinessProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "ZZTEST Alpha Tiles"));
    await closeTestDb();
  });

  describe("drafts and issuing", () => {
    it("a saved draft has no number and no frozen totals; issuing assigns the number once", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      let detail = await getQuotationDetail(db, id);
      expect(detail?.quotation.status).toBe("draft");
      expect(detail?.quotation.number).toBeNull();
      expect(detail?.current.issuedAt).toBeNull();

      const issued = await issueQuotation(db, actorId, id, NOW);
      expect(issued.number).toBe(`QT/${FY}/0001`);

      detail = await getQuotationDetail(db, id);
      expect(detail?.quotation.number).toBe(`QT/${FY}/0001`);
      expect(detail?.quotation.status).toBe("sent");
      expect(detail?.current.issuedAt).not.toBeNull();

      // Issuing again is an invalid transition and must not take another number.
      await expect(issueQuotation(db, actorId, id, NOW)).rejects.toThrow(ConflictError);
      const again = await getQuotationDetail(db, id);
      expect(again?.quotation.number).toBe(`QT/${FY}/0001`);
    });

    it("freezes the Radius 9 totals at issue: 2,870.00 taxable, CGST/SGST 258.30, round-off 0.40, 3,387.00", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      await issueQuotation(db, actorId, id, NOW);
      const detail = await getQuotationDetail(db, id);
      const r = detail!.current;
      expect(r.taxMode).toBe("intra");
      expect(r.subtotal).toBe("2870.00");
      expect(r.cgstTotal).toBe("258.30");
      expect(r.sgstTotal).toBe("258.30");
      expect(r.igstTotal).toBe("0.00");
      expect(r.roundOff).toBe("0.40");
      expect(r.grandTotal).toBe("3387.00");
      expect(r.totalInWords).toBe("INR Three Thousand Three Hundred Eighty Seven Only");
      expect(detail!.lines.map((l) => [l.lineNo, l.kind, l.taxableValue])).toEqual([
        [1, "product", "2320.00"],
        [2, "charge", "550.00"],
      ]);
      expect(detail!.lines[0].quantityAlt).toBe("62.000"); // 4 boxes cover 62 sq.ft
    });

    it("an inter-state ship-to gives IGST 516.60 and no CGST/SGST", async () => {
      const db = await getTestDb();
      const { id } = await newDraft({
        customerId: interStateCustomerId,
        billTo: { name: `${PREFIX}Jaipur Traders`, gstin: null, address: "Jaipur", stateCode: "08" },
        shipTo: { name: `${PREFIX}Jaipur Traders`, address: "Jaipur", stateCode: "08", contactName: null, contactPhone: null },
      });
      await issueQuotation(db, actorId, id, NOW);
      const r = (await getQuotationDetail(db, id))!.current;
      expect(r.placeOfSupplyStateCode).toBe("08");
      expect(r.taxMode).toBe("inter");
      expect(r.igstTotal).toBe("516.60");
      expect(r.cgstTotal).toBe("0.00");
      expect(r.sgstTotal).toBe("0.00");
      expect(r.grandTotal).toBe("3387.00");
    });

    it("issued lines keep their snapshot when the catalog product changes later", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      await issueQuotation(db, actorId, id, NOW);
      await db.update(product).set({ name: `${PREFIX}Renamed`, sellingPricePerUnit: "999.00", hsnCode: "0000", gstRate: "28" }).where(eq(product.id, tileProductId));
      const detail = await getQuotationDetail(db, id);
      expect(detail!.lines[0]).toMatchObject({ description: "ATN 600X600 8538 Plain Ivory Matt", rate: "580.00", hsnCode: "6907", gstRate: "18.00" });
      expect(detail!.current.grandTotal).toBe("3387.00");
      await db
        .update(product)
        .set({ name: `${PREFIX}ATN 600X600 8538 Plain Ivory Matt`, sellingPricePerUnit: "580.00", hsnCode: "6907", gstRate: "18" })
        .where(eq(product.id, tileProductId));
    });

    it("issues 20 quotations at once with unique, gap-free numbers (SC-004)", async () => {
      const db = await getTestDb();
      const before = await db.select().from(numberSeries).where(eq(numberSeries.financialYear, FY));
      const start = before[0].lastValue;
      const ids = await Promise.all(Array.from({ length: 20 }, () => newDraft().then((d) => d.id)));
      const issued = await Promise.all(ids.map((id) => issueQuotation(db, actorId, id, NOW)));
      const numbers = issued.map((i) => i.number).sort();
      expect(new Set(numbers).size).toBe(20);
      const expected = Array.from({ length: 20 }, (_, i) => `QT/${FY}/${String(start + i + 1).padStart(4, "0")}`);
      expect(numbers).toEqual(expected);
    });

    it("a failed issue does not burn a number", async () => {
      const db = await getTestDb();
      const [series] = await db.select().from(numberSeries).where(eq(numberSeries.financialYear, FY));
      const { id } = await newDraft();
      // Make the draft un-issuable (the product it uses is now discontinued) after it was saved.
      await db.update(product).set({ status: "discontinued" }).where(eq(product.id, tileProductId));
      await expect(issueQuotation(db, actorId, id, NOW)).rejects.toThrow(ValidationError);
      await db.update(product).set({ status: "active" }).where(eq(product.id, tileProductId));
      const [after] = await db.select().from(numberSeries).where(eq(numberSeries.financialYear, FY));
      expect(after.lastValue).toBe(series.lastValue);
      const ok = await issueQuotation(db, actorId, id, NOW);
      expect(ok.number).toBe(`QT/${FY}/${String(series.lastValue + 1).padStart(4, "0")}`);
    });
  });

  describe("validation", () => {
    it("needs at least one line", async () => {
      await expect(newDraft({ lines: [] })).rejects.toThrow(ValidationError);
    });

    it("rejects a quantity of zero, a discount over 100 and a part box", async () => {
      await expect(newDraft({ lines: [lineTile({ quantity: "0" })] })).rejects.toThrow(ValidationError);
      await expect(newDraft({ lines: [lineTile({ discountPercent: "101" })] })).rejects.toThrow(ValidationError);
      await expect(newDraft({ lines: [lineTile({ quantity: "2.5" })] })).rejects.toThrow(ValidationError);
    });

    it("valid_until cannot be before the quotation date", async () => {
      await expect(newDraft({ validUntil: "2097-06-01" })).rejects.toThrow(ValidationError);
    });

    it("a discontinued product cannot be added to a new quotation", async () => {
      const db = await getTestDb();
      const [p] = await db
        .insert(product)
        .values({ name: `${PREFIX}Old range`, unit: "box", sqftPerBox: "10", hsnCode: "6907", gstRate: "18", status: "discontinued" })
        .returning({ id: product.id });
      await expect(newDraft({ lines: [lineTile({ productId: p.id })] })).rejects.toThrow(/discontinued/i);
    });

    it("free-text lines (granite) need no product", async () => {
      const db = await getTestDb();
      const { id } = await newDraft({
        lines: [{ kind: "product", productId: null, description: "Granite - Cherry Brown", hsnCode: "6802", unit: "sqft", quantity: "37.5", rate: "180", discountPercent: "0", gstRate: "18" }],
      });
      await issueQuotation(db, actorId, id, NOW);
      const detail = await getQuotationDetail(db, id);
      expect(detail!.current.subtotal).toBe("6750.00");
    });

    it("saving again replaces the draft's lines instead of adding to them", async () => {
      const db = await getTestDb();
      const first = await newDraft();
      await saveDraft(db, actorId, draftInput({ quotationId: first.id, lines: [lineTransport()] }), NOW);
      const detail = await getQuotationDetail(db, first.id);
      expect(detail!.lines).toHaveLength(1);
      expect(detail!.revisions).toHaveLength(1);
    });

    it("an issued revision cannot be edited through saveDraft", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      await issueQuotation(db, actorId, id, NOW);
      await expect(saveDraft(db, actorId, draftInput({ quotationId: id }), NOW)).rejects.toThrow(ConflictError);
    });
  });

  describe("revisions", () => {
    it("revising keeps the number and increments the revision; revision 1 stays as issued", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      const { number } = await issueQuotation(db, actorId, id, NOW);

      await reviseQuotation(db, actorId, id, NOW);
      let detail = await getQuotationDetail(db, id);
      expect(detail!.quotation.number).toBe(number);
      expect(detail!.quotation.status).toBe("draft"); // the new revision is being edited
      expect(detail!.current.revisionNo).toBe(2);
      expect(detail!.current.issuedAt).toBeNull();
      expect(detail!.lines).toHaveLength(2); // copied from revision 1

      // Edit revision 2: only the tile line, 6 boxes.
      await saveDraft(db, actorId, draftInput({ quotationId: id, lines: [lineTile({ quantity: "6" })] }), NOW);
      const sent = await issueQuotation(db, actorId, id, NOW);
      expect(sent.number).toBe(number);

      detail = await getQuotationDetail(db, id);
      expect(detail!.quotation.status).toBe("sent");
      expect(detail!.revisions.map((r) => r.revisionNo)).toEqual([2, 1]);
      const rev1 = detail!.revisions.find((r) => r.revisionNo === 1)!;
      const rev2 = detail!.revisions.find((r) => r.revisionNo === 2)!;
      expect(rev1.grandTotal).toBe("3387.00");
      expect(rev2.subtotal).toBe("3480.00"); // 6 x 580
      const rev1Detail = await getQuotationDetail(db, id, 1);
      expect(rev1Detail!.lines).toHaveLength(2);
      expect(rev1Detail!.current.revisionNo).toBe(1);
    });

    it("cannot revise a draft, and cannot start a second revision while one is being edited", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      await expect(reviseQuotation(db, actorId, id, NOW)).rejects.toThrow(ConflictError);
      await issueQuotation(db, actorId, id, NOW);
      await reviseQuotation(db, actorId, id, NOW);
      await expect(reviseQuotation(db, actorId, id, NOW)).rejects.toThrow(ConflictError);
    });

    it("an approved quotation cannot be revised", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      await issueQuotation(db, actorId, id, NOW);
      await approveQuotation(db, actorId, id, NOW);
      await expect(reviseQuotation(db, actorId, id, NOW)).rejects.toThrow(ConflictError);
    });

    it("a rejected quotation can be revised", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      await issueQuotation(db, actorId, id, NOW);
      await rejectQuotation(db, actorId, id, "too expensive", NOW);
      await reviseQuotation(db, actorId, id, NOW);
      expect((await getQuotationDetail(db, id))!.current.revisionNo).toBe(2);
    });
  });

  describe("status transitions", () => {
    it("rejects every invalid transition", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      // draft: cannot approve, reject, reinstate, send
      await expect(approveQuotation(db, actorId, id, NOW)).rejects.toThrow(ConflictError);
      await expect(rejectQuotation(db, actorId, id, null, NOW)).rejects.toThrow(ConflictError);
      await expect(reinstateQuotation(db, actorId, id, { note: "x" }, NOW)).rejects.toThrow(ConflictError);
      await expect(sendQuotation(db, actorId, id, NOW)).resolves.toBeDefined(); // sending a draft issues it

      // sent: cannot reinstate
      await expect(reinstateQuotation(db, actorId, id, { note: "x" }, NOW)).rejects.toThrow(ConflictError);

      await approveQuotation(db, actorId, id, NOW);
      // approved is locked
      await expect(approveQuotation(db, actorId, id, NOW)).rejects.toThrow(ConflictError);
      await expect(rejectQuotation(db, actorId, id, null, NOW)).rejects.toThrow(ConflictError);
      await expect(reinstateQuotation(db, actorId, id, { note: "x" }, NOW)).rejects.toThrow(ConflictError);
      await expect(issueQuotation(db, actorId, id, NOW)).rejects.toThrow(ConflictError);
    });

    it("approve and reject stamp their dates; reinstating a rejected quotation makes it sent again with a note", async () => {
      const db = await getTestDb();
      const a = await newDraft();
      await issueQuotation(db, actorId, a.id, NOW);
      await approveQuotation(db, actorId, a.id, NOW);
      const approved = (await getQuotationDetail(db, a.id))!.quotation;
      expect(approved.status).toBe("approved");
      expect(approved.approvedAt).not.toBeNull();

      const b = await newDraft();
      await issueQuotation(db, actorId, b.id, NOW);
      await rejectQuotation(db, actorId, b.id, "customer chose another supplier", NOW);
      expect((await getQuotationDetail(db, b.id))!.quotation.status).toBe("rejected");
      await expect(reinstateQuotation(db, actorId, b.id, { note: "" }, NOW)).rejects.toThrow(ValidationError); // a note is required
      await reinstateQuotation(db, actorId, b.id, { note: "customer came back" }, NOW);
      const reinstated = (await getQuotationDetail(db, b.id))!.quotation;
      expect(reinstated.status).toBe("sent");
      expect(reinstated.rejectedAt).toBeNull();
    });

    it("writes an audit row for every status change", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      await issueQuotation(db, actorId, id, NOW);
      await approveQuotation(db, actorId, id, NOW);
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "quotation"), eq(auditLog.entityId, id)));
      const steps = rows.map((r) => `${r.action}:${r.fromStatus ?? ""}>${r.toStatus ?? ""}`).sort();
      expect(steps).toEqual(["create:>draft", "status_change:draft>sent", "status_change:sent>approved"].sort());
      expect(rows.every((r) => r.userId === actorId)).toBe(true);
    });

    it("unknown ids are reported as not found", async () => {
      const db = await getTestDb();
      await expect(issueQuotation(db, actorId, "00000000-0000-4000-8000-000000000000", NOW)).rejects.toThrow(NotFoundError);
    });
  });

  describe("expiry", () => {
    it("shows as expired after valid_until, derived without any stored change", async () => {
      const db = await getTestDb();
      const { id } = await newDraft(); // valid until 2097-06-30
      await issueQuotation(db, actorId, id, NOW);
      const detail = (await getQuotationDetail(db, id))!;
      expect(detail.quotation.status).toBe("sent");
      expect(effectiveStatus(detail.quotation.status, detail.current.validUntil, NOW)).toBe("sent");
      expect(effectiveStatus(detail.quotation.status, detail.current.validUntil, new Date("2097-06-30T20:00:00+05:30"))).toBe("sent"); // last day still valid
      expect(effectiveStatus(detail.quotation.status, detail.current.validUntil, AFTER_EXPIRY)).toBe("expired");
    });

    it("an expired quotation cannot be approved or rejected, but can be reinstated with a new date or revised", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      await issueQuotation(db, actorId, id, NOW);
      await expect(approveQuotation(db, actorId, id, AFTER_EXPIRY)).rejects.toThrow(ConflictError);
      await expect(rejectQuotation(db, actorId, id, null, AFTER_EXPIRY)).rejects.toThrow(ConflictError);
      // Reinstating needs a note and a valid_until that is not already past.
      await expect(reinstateQuotation(db, actorId, id, { note: "extend" }, AFTER_EXPIRY)).rejects.toThrow(ValidationError);
      await expect(reinstateQuotation(db, actorId, id, { note: "extend", validUntil: "2097-07-01" }, AFTER_EXPIRY)).rejects.toThrow(ValidationError);
      await reinstateQuotation(db, actorId, id, { note: "extend", validUntil: "2097-08-15" }, AFTER_EXPIRY);
      const detail = (await getQuotationDetail(db, id))!;
      expect(detail.current.validUntil).toBe("2097-08-15");
      expect(effectiveStatus(detail.quotation.status, detail.current.validUntil, AFTER_EXPIRY)).toBe("sent");
      await approveQuotation(db, actorId, id, AFTER_EXPIRY);

      const other = await newDraft();
      await issueQuotation(db, actorId, other.id, NOW);
      await reviseQuotation(db, actorId, other.id, AFTER_EXPIRY);
      expect((await getQuotationDetail(db, other.id))!.current.revisionNo).toBe(2);
    });
  });

  describe("delete and duplicate", () => {
    it("deletes a draft that never got a number; an issued or revising quotation cannot be deleted", async () => {
      const db = await getTestDb();
      const gone = await newDraft();
      await deleteDraft(db, actorId, gone.id);
      expect(await getQuotationDetail(db, gone.id)).toBeNull();

      const issued = await newDraft();
      await issueQuotation(db, actorId, issued.id, NOW);
      await expect(deleteDraft(db, actorId, issued.id)).rejects.toThrow(ConflictError);

      await reviseQuotation(db, actorId, issued.id, NOW); // draft again, but it has a number
      await expect(deleteDraft(db, actorId, issued.id)).rejects.toThrow(ConflictError);
    });

    it("duplicating starts a new unnumbered draft with the same lines", async () => {
      const db = await getTestDb();
      const { id } = await newDraft();
      const { number } = await issueQuotation(db, actorId, id, NOW);
      const copy = await duplicateQuotation(db, actorId, id, NOW);
      expect(copy.id).not.toBe(id);
      const detail = (await getQuotationDetail(db, copy.id))!;
      expect(detail.quotation.number).toBeNull();
      expect(detail.quotation.status).toBe("draft");
      expect(detail.current.revisionNo).toBe(1);
      expect(detail.current.issuedAt).toBeNull();
      expect(detail.lines).toHaveLength(2);
      expect(detail.lines[0].description).toBe("ATN 600X600 8538 Plain Ivory Matt");
      expect(detail.current.validUntil >= detail.current.quotationDate).toBe(true);
      expect((await getQuotationDetail(db, id))!.quotation.number).toBe(number);
    });
  });
});
