import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@/db";
import {
  businessProfile,
  chargeType,
  customer,
  product,
  quotation,
  quotationLine,
  quotationRevision,
  type QuotationRevision,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { taxMode } from "@/lib/gst";
import { formatMoney } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { computeQuotation, resolveQuantity, type QuoteLineInput } from "@/lib/quotation/calc";
import { parseDraft, type DraftInput, type ParsedDraft, type ParsedDraftLine } from "@/lib/quotation/schema";
import { addDays, canDo, effectiveStatus, istDate, refusalMessage, type QuotationAction } from "@/lib/quotation/status";

export type { DraftInput } from "@/lib/quotation/schema";

// Quotation domain operations (T044). Each takes the database and the acting user's id, runs in one
// transaction (so the number, the frozen totals and the audit row commit or roll back together) and has no
// session or framework dependency: src/server/quotations.ts wraps them with requireUser() for the UI, and the
// integration tests call them directly against the TEST database.

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function businessInfo(tx: Tx): Promise<{ stateCode: string; validityDays: number }> {
  const [profile] = await tx
    .select({ stateCode: businessProfile.stateCode, validityDays: businessProfile.defaultQuotationValidityDays })
    .from(businessProfile)
    .limit(1);
  if (!profile) throw new ConflictError("Set up the business profile (Settings) before creating quotations");
  return profile;
}

/** Locks the quotation row for the rest of the transaction so concurrent actions on it queue up. */
async function lockQuotation(tx: Tx, id: string) {
  const [row] = await tx.select().from(quotation).where(eq(quotation.id, id)).for("update");
  if (!row) throw new NotFoundError("That quotation no longer exists");
  if (!row.currentRevisionId) throw new ConflictError("This quotation has no revision");
  const [revision] = await tx.select().from(quotationRevision).where(eq(quotationRevision.id, row.currentRevisionId));
  if (!revision) throw new ConflictError("This quotation has no revision");
  return { row, revision };
}

function assertCan(action: QuotationAction, row: { status: Parameters<typeof effectiveStatus>[0]; number: string | null }, revision: QuotationRevision, now: Date) {
  const view = effectiveStatus(row.status, revision.validUntil, now);
  if (!canDo(action, view, row.number !== null)) throw new ConflictError(refusalMessage(action, view));
  return view;
}

/** Place of supply is where the goods go (ship-to), falling back to the bill-to state. */
function placeOfSupply(draft: Pick<ParsedDraft, "billTo" | "shipTo">): string {
  return draft.shipTo.stateCode ?? draft.billTo.stateCode;
}

/** Discontinued products cannot be added to a quotation; ones an earlier issued revision already carries may stay. */
async function assertProductsUsable(tx: Tx, quotationId: string | null, lines: ParsedDraftLine[]) {
  const productIds = [...new Set(lines.map((l) => l.productId).filter((v): v is string => v !== null))];
  if (productIds.length) {
    const rows = await tx.select({ id: product.id, name: product.name, status: product.status }).from(product).where(inArray(product.id, productIds));
    if (rows.length !== productIds.length) throw new ValidationError("A product on this quotation no longer exists; remove that line");
    const discontinued = rows.filter((r) => r.status === "discontinued");
    if (discontinued.length) {
      const alreadyQuoted = new Set<string>();
      if (quotationId) {
        const prior = await tx
          .select({ productId: quotationLine.productId })
          .from(quotationLine)
          .innerJoin(quotationRevision, eq(quotationLine.revisionId, quotationRevision.id))
          .where(and(eq(quotationRevision.quotationId, quotationId), isNotNull(quotationRevision.issuedAt)));
        for (const p of prior) if (p.productId) alreadyQuoted.add(p.productId);
      }
      const blocked = discontinued.find((r) => !alreadyQuoted.has(r.id));
      if (blocked) throw new ValidationError(`${blocked.name} is discontinued and cannot be added to a new quotation`);
    }
  }
  const chargeIds = [...new Set(lines.map((l) => l.chargeTypeId).filter((v): v is string => v !== null))];
  if (chargeIds.length) {
    const rows = await tx.select({ id: chargeType.id }).from(chargeType).where(inArray(chargeType.id, chargeIds));
    if (rows.length !== chargeIds.length) throw new ValidationError("A charge on this quotation no longer exists; remove that line");
  }
}

/** Converts calculation failures (RangeError) into messages the person can act on. */
function calculate(lines: ParsedDraftLine[], mode: "intra" | "inter", advance: string) {
  const inputs: QuoteLineInput[] = [];
  const resolved = lines.map((line, i) => {
    try {
      const qty = resolveQuantity({ unit: line.unit, entered: line.quantity, enteredIn: line.unit, sqftPerBox: line.sqftPerBox });
      inputs.push({ kind: line.kind, quantity: qty.quantity, rate: line.rate, discountPercent: line.discountPercent, gstRate: line.gstRate, hsnCode: line.hsnCode });
      return qty;
    } catch (error) {
      if (error instanceof RangeError) throw new ValidationError(`Line ${i + 1}: ${error.message}`);
      throw error;
    }
  });
  try {
    const totals = computeQuotation(inputs, mode, { advance });
    if (totals.advance.greaterThan(totals.grandTotal)) throw new ValidationError("The advance cannot be more than the total");
    return { totals, resolved };
  } catch (error) {
    if (error instanceof RangeError) throw new ValidationError(error.message);
    throw error;
  }
}

/** Replaces the revision's lines and writes the figures that follow from them. Returns nothing; throws ValidationError. */
async function writeRevisionFigures(tx: Tx, revisionId: string, draft: ParsedDraft, businessStateCode: string) {
  const mode = taxMode(placeOfSupply(draft), businessStateCode);
  const { totals, resolved } = calculate(draft.lines, mode, draft.advanceAmount);

  await tx.delete(quotationLine).where(eq(quotationLine.revisionId, revisionId));
  await tx.insert(quotationLine).values(
    draft.lines.map((line, i) => {
      const result = totals.lines[i];
      const qty = resolved[i];
      return {
        revisionId,
        lineNo: i + 1,
        kind: line.kind,
        productId: line.productId,
        chargeTypeId: line.chargeTypeId,
        description: line.description,
        hsnCode: line.hsnCode,
        unit: line.unit,
        piecesPerBox: line.piecesPerBox,
        sqftPerBox: line.sqftPerBox,
        quantity: qty.quantity.toFixed(3),
        quantityAlt: qty.quantityAlt ? qty.quantityAlt.toFixed(3) : null,
        rate: formatMoney(line.rate),
        discountPercent: formatMoney(line.discountPercent),
        taxableValue: formatMoney(result.taxableValue),
        gstRate: formatMoney(line.gstRate),
        cgstAmount: formatMoney(result.cgst),
        sgstAmount: formatMoney(result.sgst),
        igstAmount: formatMoney(result.igst),
        lineTotal: formatMoney(result.lineTotal),
      };
    }),
  );

  await tx
    .update(quotationRevision)
    .set({
      quotationDate: draft.quotationDate!,
      validUntil: draft.validUntil,
      billToName: draft.billTo.name,
      billToGstin: draft.billTo.gstin,
      billToAddress: draft.billTo.address,
      billToStateCode: draft.billTo.stateCode,
      shipToName: draft.shipTo.name,
      shipToAddress: draft.shipTo.address,
      shipToStateCode: draft.shipTo.stateCode,
      siteContactName: draft.shipTo.contactName,
      siteContactPhone: draft.shipTo.contactPhone,
      placeOfSupplyStateCode: placeOfSupply(draft),
      taxMode: mode,
      layout: draft.layout,
      termsText: draft.terms,
      advanceAmount: formatMoney(draft.advanceAmount),
      subtotal: formatMoney(totals.taxableTotal),
      cgstTotal: formatMoney(totals.cgstTotal),
      sgstTotal: formatMoney(totals.sgstTotal),
      igstTotal: formatMoney(totals.igstTotal),
      roundOff: formatMoney(totals.roundOff),
      grandTotal: formatMoney(totals.grandTotal),
      totalInWords: totals.totalInWords,
      notes: draft.notes,
      // Any change invalidates the cached PDF.
      pdfFileId: null,
      pdfLayout: null,
    })
    .where(eq(quotationRevision.id, revisionId));
}

/** Reads a stored revision back into editor form, so issue can recompute exactly what the draft shows. */
async function revisionAsDraft(tx: Tx, quotationId: string, customerId: string, revision: QuotationRevision): Promise<ParsedDraft> {
  const lines = await tx.select().from(quotationLine).where(eq(quotationLine.revisionId, revision.id)).orderBy(quotationLine.lineNo);
  return parseDraft({
    quotationId,
    customerId,
    quotationDate: revision.quotationDate,
    validUntil: revision.validUntil,
    billTo: { name: revision.billToName, gstin: revision.billToGstin, address: revision.billToAddress, stateCode: revision.billToStateCode },
    shipTo: {
      name: revision.shipToName,
      address: revision.shipToAddress,
      stateCode: revision.shipToStateCode,
      contactName: revision.siteContactName,
      contactPhone: revision.siteContactPhone,
    },
    layout: revision.layout,
    terms: revision.termsText,
    advanceAmount: revision.advanceAmount,
    notes: revision.notes,
    lines: lines.map((l) => ({
      kind: l.kind,
      productId: l.productId,
      chargeTypeId: l.chargeTypeId,
      description: l.description,
      hsnCode: l.hsnCode,
      unit: l.unit,
      piecesPerBox: l.piecesPerBox,
      sqftPerBox: l.sqftPerBox,
      quantity: l.quantity,
      rate: l.rate,
      discountPercent: l.discountPercent,
      gstRate: l.gstRate,
    })),
  });
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Creates a draft, or replaces the lines and details of the draft (or revision being edited) given by `quotationId`. */
export async function saveDraft(db: Database, actorId: string, input: DraftInput, now: Date = new Date()): Promise<{ id: string; revisionId: string }> {
  const draft = parseDraft(input);
  draft.quotationDate ??= istDate(now);
  if (draft.validUntil < draft.quotationDate) throw new ValidationError("Valid until cannot be before the quotation date");
  return db.transaction(async (tx) => {
    const business = await businessInfo(tx);
    const [owner] = await tx.select({ id: customer.id }).from(customer).where(eq(customer.id, draft.customerId));
    if (!owner) throw new ValidationError("That customer no longer exists");

    if (draft.quotationId) {
      const { row, revision } = await lockQuotation(tx, draft.quotationId);
      if (row.status !== "draft") {
        throw new ConflictError(
          row.status === "approved" ? "This quotation is approved and locked" : "An issued quotation cannot be edited; revise it to make changes",
        );
      }
      await assertProductsUsable(tx, row.id, draft.lines);
      await writeRevisionFigures(tx, revision.id, draft, business.stateCode);
      await tx.update(quotation).set({ customerId: draft.customerId }).where(eq(quotation.id, row.id));
      return { id: row.id, revisionId: revision.id };
    }

    await assertProductsUsable(tx, null, draft.lines);
    const [created] = await tx.insert(quotation).values({ customerId: draft.customerId, status: "draft", createdBy: actorId }).returning({ id: quotation.id });
    const [revision] = await tx
      .insert(quotationRevision)
      .values({
        quotationId: created.id,
        revisionNo: 1,
        quotationDate: draft.quotationDate!,
        validUntil: draft.validUntil,
        billToName: draft.billTo.name,
        billToStateCode: draft.billTo.stateCode,
        placeOfSupplyStateCode: placeOfSupply(draft),
        taxMode: taxMode(placeOfSupply(draft), business.stateCode),
      })
      .returning({ id: quotationRevision.id });
    await writeRevisionFigures(tx, revision.id, draft, business.stateCode);
    await tx.update(quotation).set({ currentRevisionId: revision.id }).where(eq(quotation.id, created.id));
    await recordAudit(tx, { userId: actorId, entityType: "quotation", entityId: created.id, action: "create", toStatus: "draft" });
    return { id: created.id, revisionId: revision.id };
  });
}

/**
 * Takes a draft (or a revision being edited) out of draft: assigns the number if the quotation has none yet,
 * recomputes and freezes the figures, and marks it sent. The number comes from the same transaction, so a failure
 * anywhere here gives it back (gap-free, SC-004).
 */
export async function issueQuotation(db: Database, actorId: string, id: string, now: Date = new Date()): Promise<{ number: string }> {
  return db.transaction(async (tx) => {
    const { row, revision } = await lockQuotation(tx, id);
    assertCan("issue", row, revision, now);
    const business = await businessInfo(tx);

    // Recompute from the stored lines with the current business state, then freeze.
    const draft = await revisionAsDraft(tx, row.id, row.customerId, revision);
    if (draft.validUntil < istDate(now)) throw new ValidationError("Valid until is already in the past; choose a later date before issuing");
    await assertProductsUsable(tx, row.id, draft.lines);
    await writeRevisionFigures(tx, revision.id, draft, business.stateCode);

    const number = row.number ?? (await nextNumber(tx, "quotation", now)).number;
    await tx.update(quotationRevision).set({ issuedAt: now, sentAt: now }).where(eq(quotationRevision.id, revision.id));
    await tx.update(quotation).set({ number, status: "sent", rejectedAt: null }).where(eq(quotation.id, row.id));
    await recordAudit(tx, {
      userId: actorId,
      entityType: "quotation",
      entityId: row.id,
      action: "status_change",
      fromStatus: "draft",
      toStatus: "sent",
      note: `${number} revision ${revision.revisionNo}`,
    });
    return { number };
  });
}

/**
 * "Send": a draft is issued (and so sent); an already sent quotation records that it was sent to the customer
 * again, for example after sharing the PDF link a second time.
 */
export async function sendQuotation(db: Database, actorId: string, id: string, now: Date = new Date()): Promise<{ number: string }> {
  const [current] = await db.select({ status: quotation.status }).from(quotation).where(eq(quotation.id, id));
  if (!current) throw new NotFoundError("That quotation no longer exists");
  if (current.status === "draft") return issueQuotation(db, actorId, id, now);
  return db.transaction(async (tx) => {
    const { row, revision } = await lockQuotation(tx, id);
    assertCan("send", row, revision, now);
    await tx.update(quotationRevision).set({ sentAt: now }).where(eq(quotationRevision.id, revision.id));
    await recordAudit(tx, { userId: actorId, entityType: "quotation", entityId: row.id, action: "send", note: `${row.number} revision ${revision.revisionNo}` });
    return { number: row.number! };
  });
}

export async function approveQuotation(db: Database, actorId: string, id: string, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const { row, revision } = await lockQuotation(tx, id);
    assertCan("approve", row, revision, now);
    await tx.update(quotation).set({ status: "approved", approvedAt: now }).where(eq(quotation.id, row.id));
    await recordAudit(tx, { userId: actorId, entityType: "quotation", entityId: row.id, action: "status_change", fromStatus: "sent", toStatus: "approved", note: row.number });
  });
}

export async function rejectQuotation(db: Database, actorId: string, id: string, note: string | null, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const { row, revision } = await lockQuotation(tx, id);
    assertCan("reject", row, revision, now);
    await tx.update(quotation).set({ status: "rejected", rejectedAt: now }).where(eq(quotation.id, row.id));
    await recordAudit(tx, {
      userId: actorId,
      entityType: "quotation",
      entityId: row.id,
      action: "status_change",
      fromStatus: "sent",
      toStatus: "rejected",
      note: note?.trim() || row.number,
    });
  });
}

/**
 * Rejected or expired -> sent again. A note is required. An expired quotation needs a new valid-until date, since
 * otherwise it would expire again at once.
 */
export async function reinstateQuotation(
  db: Database,
  actorId: string,
  id: string,
  options: { note: string; validUntil?: string | null },
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const { row, revision } = await lockQuotation(tx, id);
    const view = assertCan("reinstate", row, revision, now);
    const note = options.note.trim();
    if (!note) throw new ValidationError("Add a note saying why this quotation is being reinstated");
    const today = istDate(now);
    const newValidUntil = options.validUntil?.trim() || null;
    if (newValidUntil !== null && !/^\d{4}-\d{2}-\d{2}$/.test(newValidUntil)) throw new ValidationError("Valid until must be a date");
    if (view === "expired" && newValidUntil === null) throw new ValidationError("Choose a new valid-until date for the expired quotation");
    if (newValidUntil !== null && newValidUntil < today) throw new ValidationError("Valid until cannot be in the past");
    if (newValidUntil !== null && newValidUntil < revision.quotationDate) throw new ValidationError("Valid until cannot be before the quotation date");

    if (newValidUntil !== null) {
      await tx.update(quotationRevision).set({ validUntil: newValidUntil, pdfFileId: null, pdfLayout: null }).where(eq(quotationRevision.id, revision.id));
    }
    await tx.update(quotation).set({ status: "sent", rejectedAt: null }).where(eq(quotation.id, row.id));
    await recordAudit(tx, { userId: actorId, entityType: "quotation", entityId: row.id, action: "status_change", fromStatus: view, toStatus: "sent", note });
  });
}

/** Copies a revision (its details and lines) into a new revision row, unissued and with fresh dates. */
async function cloneRevision(tx: Tx, source: QuotationRevision, target: { quotationId: string; revisionNo: number }, today: string, validityDays: number) {
  const [created] = await tx
    .insert(quotationRevision)
    .values({
      quotationId: target.quotationId,
      revisionNo: target.revisionNo,
      quotationDate: today,
      validUntil: addDays(today, validityDays),
      billToName: source.billToName,
      billToGstin: source.billToGstin,
      billToAddress: source.billToAddress,
      billToStateCode: source.billToStateCode,
      shipToName: source.shipToName,
      shipToAddress: source.shipToAddress,
      shipToStateCode: source.shipToStateCode,
      siteContactName: source.siteContactName,
      siteContactPhone: source.siteContactPhone,
      placeOfSupplyStateCode: source.placeOfSupplyStateCode,
      taxMode: source.taxMode,
      layout: source.layout,
      termsText: source.termsText,
      advanceAmount: source.advanceAmount,
      subtotal: source.subtotal,
      cgstTotal: source.cgstTotal,
      sgstTotal: source.sgstTotal,
      igstTotal: source.igstTotal,
      roundOff: source.roundOff,
      grandTotal: source.grandTotal,
      totalInWords: source.totalInWords,
      notes: source.notes,
    })
    .returning({ id: quotationRevision.id });
  const lines = await tx.select().from(quotationLine).where(eq(quotationLine.revisionId, source.id)).orderBy(quotationLine.lineNo);
  if (lines.length) {
    await tx.insert(quotationLine).values(
      lines.map((l) => ({
        revisionId: created.id,
        lineNo: l.lineNo,
        kind: l.kind,
        productId: l.productId,
        chargeTypeId: l.chargeTypeId,
        description: l.description,
        hsnCode: l.hsnCode,
        unit: l.unit,
        piecesPerBox: l.piecesPerBox,
        sqftPerBox: l.sqftPerBox,
        quantity: l.quantity,
        quantityAlt: l.quantityAlt,
        rate: l.rate,
        discountPercent: l.discountPercent,
        taxableValue: l.taxableValue,
        gstRate: l.gstRate,
        cgstAmount: l.cgstAmount,
        sgstAmount: l.sgstAmount,
        igstAmount: l.igstAmount,
        lineTotal: l.lineTotal,
      })),
    );
  }
  return created.id;
}

/**
 * Starts revision n+1 as an editable copy of the current one. The number is kept and earlier revisions stay as they
 * were issued. The quotation goes back to draft until the new revision is issued. Not possible once approved.
 */
export async function reviseQuotation(db: Database, actorId: string, id: string, now: Date = new Date()): Promise<{ revisionNo: number }> {
  return db.transaction(async (tx) => {
    const { row, revision } = await lockQuotation(tx, id);
    const view = assertCan("revise", row, revision, now);
    const business = await businessInfo(tx);
    const [latest] = await tx
      .select({ revisionNo: quotationRevision.revisionNo })
      .from(quotationRevision)
      .where(eq(quotationRevision.quotationId, row.id))
      .orderBy(desc(quotationRevision.revisionNo))
      .limit(1);
    const revisionNo = latest.revisionNo + 1;
    const newId = await cloneRevision(tx, revision, { quotationId: row.id, revisionNo }, istDate(now), business.validityDays);
    await tx.update(quotation).set({ currentRevisionId: newId, status: "draft", rejectedAt: null }).where(eq(quotation.id, row.id));
    await recordAudit(tx, {
      userId: actorId,
      entityType: "quotation",
      entityId: row.id,
      action: "revise",
      fromStatus: view,
      toStatus: "draft",
      note: `${row.number} revision ${revisionNo}`,
    });
    return { revisionNo };
  });
}

/** A new, unnumbered draft with the same customer, details and lines as an existing quotation (FR-020). */
export async function duplicateQuotation(db: Database, actorId: string, id: string, now: Date = new Date()): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const { row, revision } = await lockQuotation(tx, id);
    const business = await businessInfo(tx);
    const [created] = await tx.insert(quotation).values({ customerId: row.customerId, status: "draft", createdBy: actorId }).returning({ id: quotation.id });
    const revisionId = await cloneRevision(tx, revision, { quotationId: created.id, revisionNo: 1 }, istDate(now), business.validityDays);
    await tx.update(quotation).set({ currentRevisionId: revisionId }).where(eq(quotation.id, created.id));
    await recordAudit(tx, {
      userId: actorId,
      entityType: "quotation",
      entityId: created.id,
      action: "create",
      toStatus: "draft",
      note: `duplicated from ${row.number ?? "a draft"}`,
    });
    return { id: created.id };
  });
}

/** Deletes a draft that never got a number. Anything numbered stays on record. */
export async function deleteDraft(db: Database, actorId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { row, revision } = await lockQuotation(tx, id);
    if (row.number !== null) throw new ConflictError("This quotation has a number and stays on record; it cannot be deleted");
    assertCan("delete", row, revision, new Date());
    await tx.delete(quotation).where(eq(quotation.id, row.id));
    await recordAudit(tx, { userId: actorId, entityType: "quotation", entityId: row.id, action: "delete", fromStatus: "draft", note: "draft deleted" });
  });
}
