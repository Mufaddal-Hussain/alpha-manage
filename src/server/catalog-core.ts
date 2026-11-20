import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  auditLog,
  brand,
  design,
  importJob,
  importRow,
  priceGroup,
  priceGroupDesign,
  priceList,
  product,
  type ImportDefaults,
  type ImportRowKind,
  type ImportRowPayload,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { costForUnit, marginFromPrice, priceFromMargin } from "@/lib/catalog/pricing";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { diffAgainstCurrent, type CurrentGroup, type RemovedGroup } from "@/lib/import/price-list-diff";
import { nameKey, splitDesigns, TEMPLATE_COLUMNS, validatePriceRows, type PriceRow, type RawRow } from "@/lib/import/price-list-rules";
import { readRawRows } from "@/lib/import/price-list-template";
import { dec, round2 } from "@/lib/money";

// Domain operations of the catalog and price-list import (T057). They take the database client (or a test
// database) and the acting user, like quotation-core.ts; `catalog.ts` wraps them as server actions.
// Import never writes `selling_price_per_unit`: a changed cost only flags the product for review (FR-009, spec US2).

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const CHUNK = 500;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const lowerName = <T extends { name: unknown }>(table: T) => sql`lower(${table.name as never})`;

// ---------------------------------------------------------------------------
// Parsing and diffing into review rows
// ---------------------------------------------------------------------------

interface ReviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  kind: ImportRowKind;
  message: string | null;
  payload: ImportRowPayload;
  /** Default decision for a freshly computed row. */
  accepted: boolean;
}

/** The brand's current published list as comparable groups, keyed by brand id. */
async function currentGroupsByBrand(db: Database | Tx, brandIds: string[]) {
  const result = new Map<string, { groups: CurrentGroup[]; effectiveFrom: string; brandName: string }>();
  if (brandIds.length === 0) return result;
  const lists = await db
    .select({ id: priceList.id, brandId: priceList.brandId, effectiveFrom: priceList.effectiveFrom, brandName: brand.name })
    .from(priceList)
    .innerJoin(brand, eq(brand.id, priceList.brandId))
    .where(and(inArray(priceList.brandId, brandIds), eq(priceList.status, "published")));
  if (lists.length === 0) return result;
  const rows = await db
    .select({
      listId: priceGroup.priceListId,
      groupId: priceGroup.id,
      sizeLabel: priceGroup.sizeLabel,
      finish: priceGroup.finish,
      piecesPerBox: priceGroup.piecesPerBox,
      sqftPerBox: priceGroup.sqftPerBox,
      ratePerBox: priceGroup.ratePerBox,
      ratePerSqft: priceGroup.ratePerSqft,
      designName: design.name,
    })
    .from(priceGroup)
    .leftJoin(priceGroupDesign, eq(priceGroupDesign.priceGroupId, priceGroup.id))
    .leftJoin(design, eq(design.id, priceGroupDesign.designId))
    .where(inArray(priceGroup.priceListId, lists.map((l) => l.id)))
    .orderBy(asc(priceGroup.sortOrder));
  for (const list of lists) {
    const byGroup = new Map<string, CurrentGroup>();
    for (const r of rows) {
      if (r.listId !== list.id) continue;
      let group = byGroup.get(r.groupId);
      if (!group) {
        group = { sizeLabel: r.sizeLabel, finish: r.finish, piecesPerBox: r.piecesPerBox, sqftPerBox: r.sqftPerBox, ratePerBox: r.ratePerBox, ratePerSqft: r.ratePerSqft, designs: [] };
        byGroup.set(r.groupId, group);
      }
      if (r.designName) group.designs.push(r.designName);
    }
    result.set(list.brandId, { groups: [...byGroup.values()], effectiveFrom: list.effectiveFrom, brandName: list.brandName });
  }
  return result;
}

/**
 * Validates the raw rows, compares them with each brand's current published list and returns what the review
 * screen shows. Used when an import starts and again after a row is corrected.
 */
async function computeReview(db: Database | Tx, raws: { rowNumber: number; raw: Record<string, string> }[], expectedBrandId: string | null): Promise<ReviewRow[]> {
  const results = validatePriceRows(raws.map((r): RawRow => ({ rowNumber: r.rowNumber, cells: r.raw })));

  let expectedName: string | null = null;
  if (expectedBrandId) {
    const [b] = await db.select({ name: brand.name }).from(brand).where(eq(brand.id, expectedBrandId));
    expectedName = b?.name ?? null;
  }
  if (expectedName) {
    for (const result of results) {
      if (result.row && nameKey(result.row.brand) !== nameKey(expectedName)) {
        result.errors.push(`This row is for ${result.row.brand}, but the import was started for ${expectedName}`);
        result.row = null;
      }
    }
  }

  const brandKeys = [...new Set(results.flatMap((r) => (r.row ? [nameKey(r.row.brand)] : [])))];
  const existing = brandKeys.length
    ? await db.select({ id: brand.id, name: brand.name }).from(brand).where(inArray(lowerName(brand), brandKeys))
    : [];
  const brandByKey = new Map(existing.map((b) => [nameKey(b.name), b]));
  const current = await currentGroupsByBrand(db, existing.map((b) => b.id));

  const unreadable = results.flatMap((r, i) => (r.row ? [] : splitDesigns(raws[i].raw.designs ?? "").designs));

  const out: (ReviewRow | null)[] = results.map(() => null);
  const removedRows: ReviewRow[] = [];
  for (const key of brandKeys) {
    const known = brandByKey.get(key);
    const indices = results.flatMap((r, i) => (r.row && nameKey(r.row.brand) === key ? [i] : []));
    const incoming = indices.map((i) => results[i].row!);
    const groups = known ? (current.get(known.id)?.groups ?? []) : [];
    const diff = diffAgainstCurrent(groups, incoming, { unreadableDesigns: unreadable });
    indices.forEach((resultIndex, n) => {
      const r = results[resultIndex];
      out[resultIndex] = {
        rowNumber: r.rowNumber,
        raw: raws[resultIndex].raw,
        kind: diff.rows[n].kind,
        message: null,
        payload: { row: r.row, designs: diff.rows[n].designs, warnings: r.warnings, ...(known ? {} : { brandIsNew: true }) },
        accepted: true,
      };
    });
    const info = known ? current.get(known.id) : undefined;
    for (const gone of diff.removed) removedRows.push(removedReviewRow(info?.brandName ?? incoming[0].brand, info?.effectiveFrom ?? incoming[0].effectiveFrom, gone));
  }
  results.forEach((r, i) => {
    if (out[i]) return;
    out[i] = {
      rowNumber: r.rowNumber,
      raw: raws[i].raw,
      kind: "error",
      message: r.errors.join("; "),
      payload: { row: null, designs: [], warnings: r.warnings },
      accepted: false,
    };
  });
  return [...(out as ReviewRow[]), ...removedRows];
}

function removedReviewRow(brandName: string, effectiveFrom: string, gone: RemovedGroup): ReviewRow {
  const row: PriceRow = {
    brand: brandName,
    listLabel: null,
    effectiveFrom,
    size: gone.sizeLabel,
    lengthMm: null,
    widthMm: null,
    piecesPerBox: gone.piecesPerBox,
    sqftPerBox: gone.sqftPerBox,
    finish: gone.finish,
    ratePerBox: gone.ratePerBox,
    ratePerSqft: gone.ratePerSqft,
    designs: gone.designs,
    hsnCode: null,
  };
  return {
    rowNumber: 0,
    raw: {},
    kind: "removed",
    message: "In the current list but not in this one. Tick it to mark the products discontinued; otherwise they stay active.",
    payload: { row, designs: [], warnings: [] },
    accepted: false,
  };
}

async function insertReviewRows(tx: Tx, jobId: string, rows: ReviewRow[]) {
  for (const part of chunks(rows, 200)) {
    await tx.insert(importRow).values(
      part.map((r) => ({ jobId, rowNumber: r.rowNumber, raw: r.raw, payload: r.payload, kind: r.kind, message: r.message, accepted: r.accepted })),
    );
  }
}

// ---------------------------------------------------------------------------
// Starting an import
// ---------------------------------------------------------------------------

export interface StartImportInput {
  /** Original file name; its extension (.xlsx or .csv) decides how it is read. */
  fileName: string;
  bytes: Buffer;
  /** If given, every row must be for this brand. */
  expectedBrandId?: string | null;
  sourceFileId?: string | null;
  /** The distributor's PDF, attached to each price list this import creates for reference only. */
  referenceFileId?: string | null;
  defaults: ImportDefaults;
}

/** Reads the template, compares it with the current lists and saves a job in `needs_review`. Nothing else is saved. */
export async function createImportJob(db: Database, actorId: string, input: StartImportInput): Promise<{ jobId: string }> {
  const sheet = await readRawRows(input.bytes, input.fileName);
  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(importJob)
      .values({
        brandId: input.expectedBrandId ?? null,
        sourceFileId: input.sourceFileId ?? null,
        referenceFileId: input.referenceFileId ?? null,
        sourceName: input.fileName,
        sourceType: "excel",
        status: sheet.fileErrors.length > 0 ? "failed" : "needs_review",
        rowCount: sheet.rows.length,
        errorSummary: sheet.fileErrors.length > 0 ? sheet.fileErrors.join(" ") : null,
        defaults: input.defaults,
        createdBy: actorId,
      })
      .returning({ id: importJob.id });
    if (sheet.fileErrors.length === 0) {
      const review = await computeReview(tx, sheet.rows.map((r) => ({ rowNumber: r.rowNumber, raw: r.cells as Record<string, string> })), input.expectedBrandId ?? null);
      await insertReviewRows(tx, job.id, review);
    }
    await recordAudit(tx, {
      userId: actorId,
      entityType: "import_job",
      entityId: job.id,
      action: "create",
      toStatus: sheet.fileErrors.length > 0 ? "failed" : "needs_review",
      note: input.fileName,
    });
    return { jobId: job.id };
  });
}

// ---------------------------------------------------------------------------
// Review: accept, skip, fix
// ---------------------------------------------------------------------------

async function loadOpenJob(tx: Tx, jobId: string, lock = true) {
  const query = tx.select().from(importJob).where(eq(importJob.id, jobId));
  const [job] = await (lock ? query.for("update") : query);
  if (!job) throw new NotFoundError("That import no longer exists");
  if (job.status !== "needs_review") throw new ConflictError(job.status === "approved" ? "This import was already approved" : "This import cannot be changed any more");
  return job;
}

/** Include (or leave out) a row in the new price list. For a `removed` row it means "mark these products discontinued". */
export async function setImportRowAccepted(db: Database, actorId: string, rowId: string, accepted: boolean): Promise<void> {
  void actorId;
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(importRow).where(eq(importRow.id, rowId));
    if (!row) throw new NotFoundError("That row no longer exists");
    await loadOpenJob(tx, row.jobId);
    if (accepted && row.kind === "error") throw new ValidationError("Fix this row before accepting it");
    await tx.update(importRow).set({ accepted }).where(eq(importRow.id, rowId));
  });
}

/** Replaces the cell text of one row, then re-validates and re-compares the whole job (rules that look across rows). */
export async function correctImportRow(db: Database, actorId: string, rowId: string, cells: Record<string, string>): Promise<void> {
  void actorId;
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(importRow).where(eq(importRow.id, rowId));
    if (!row) throw new NotFoundError("That row no longer exists");
    if (row.kind === "removed") throw new ValidationError("A removed design has no values to fix");
    const job = await loadOpenJob(tx, row.jobId);

    const clean: Record<string, string> = {};
    for (const column of TEMPLATE_COLUMNS) clean[column] = String(cells[column] ?? "").trim().slice(0, 4000);
    await tx.update(importRow).set({ raw: clean }).where(eq(importRow.id, rowId));

    const all = await tx.select().from(importRow).where(eq(importRow.jobId, job.id)).orderBy(asc(importRow.rowNumber));
    const sourceRows = all.filter((r) => r.kind !== "removed").map((r) => ({ id: r.id, rowNumber: r.rowNumber, raw: r.id === rowId ? clean : r.raw }));
    const fresh = await computeReview(tx, sourceRows, job.brandId);

    const before = new Map(all.filter((r) => r.kind !== "removed").map((r) => [r.rowNumber, r]));
    for (const next of fresh.filter((r) => r.kind !== "removed")) {
      const prev = before.get(next.rowNumber)!;
      const wasError = prev.kind === "error";
      // A row that was fine keeps the person's accept/skip choice; a row that has just been fixed starts accepted.
      const accepted = next.kind === "error" ? false : wasError ? true : prev.accepted;
      const same = prev.kind === next.kind && prev.message === next.message && prev.accepted === accepted && JSON.stringify(prev.payload) === JSON.stringify(next.payload);
      if (!same) await tx.update(importRow).set({ kind: next.kind, message: next.message, payload: next.payload, accepted }).where(eq(importRow.id, prev.id));
    }

    // Removed designs depend on which designs the rows still contain, so they are recomputed too; decisions are kept.
    const oldRemoved = all.filter((r) => r.kind === "removed");
    const decisions = new Map(oldRemoved.map((r) => [removedKey(r.payload.row), r.accepted]));
    if (oldRemoved.length) await tx.delete(importRow).where(and(eq(importRow.jobId, job.id), eq(importRow.kind, "removed")));
    const removed = fresh.filter((r) => r.kind === "removed").map((r) => ({ ...r, accepted: decisions.get(removedKey(r.payload.row)) ?? false }));
    await insertReviewRows(tx, job.id, removed);
  });
}

const removedKey = (row: PriceRow | null) => (row ? `${nameKey(row.brand)}|${nameKey(row.size)}|${nameKey(row.finish)}|${row.designs.map(nameKey).join(",")}` : "");

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export interface ApproveResult {
  priceListIds: string[];
  newProducts: number;
  costChanges: number;
  discontinued: number;
}

interface ProductUpdate {
  id: string;
  priceGroupId: string;
  cost: string;
  previousCost: string | null;
  review: boolean;
  margin: string | null;
  pieces: number;
  sqft: string;
}

/** Turns the accepted rows into a new published price list per brand, creating designs and products, and flags changed costs. */
export async function approveImportJob(db: Database, actorId: string, jobId: string, now: Date = new Date()): Promise<ApproveResult> {
  return db.transaction(async (tx) => {
    const job = await loadOpenJob(tx, jobId);
    const rows = await tx.select().from(importRow).where(eq(importRow.jobId, jobId)).orderBy(asc(importRow.rowNumber));
    const toCreate = rows.filter((r) => r.accepted && r.payload.row && r.kind !== "error" && r.kind !== "removed");
    const toDiscontinue = rows.filter((r) => r.accepted && r.kind === "removed" && r.payload.row);
    if (toCreate.length === 0 && toDiscontinue.length === 0) throw new ValidationError("Accept at least one row before approving");

    const result: ApproveResult = { priceListIds: [], newProducts: 0, costChanges: 0, discontinued: 0 };
    const auditRows: (typeof auditLog.$inferInsert)[] = [];

    // Group the accepted rows by brand, keeping the file's order.
    const byBrand = new Map<string, { name: string; created: typeof toCreate; removed: typeof toDiscontinue }>();
    for (const r of [...toCreate, ...toDiscontinue]) {
      const name = r.payload.row!.brand;
      const key = nameKey(name);
      const entry = byBrand.get(key) ?? { name, created: [], removed: [] };
      (r.kind === "removed" ? entry.removed : entry.created).push(r);
      byBrand.set(key, entry);
    }

    for (const entry of byBrand.values()) {
      // Brand: existing (any case) or created now.
      let [b] = await tx.select().from(brand).where(eq(lowerName(brand), nameKey(entry.name))).for("update");
      if (!b) {
        [b] = await tx.insert(brand).values({ name: entry.name }).returning();
        auditRows.push({ userId: actorId, entityType: "brand", entityId: b.id, action: "create", note: `${b.name} (created by price-list import)` });
      }

      // Designs of this brand: existing ones are reused, missing ones created.
      const existingDesigns = await tx.select({ id: design.id, name: design.name }).from(design).where(eq(design.brandId, b.id));
      const designId = new Map(existingDesigns.map((d) => [nameKey(d.name), d.id]));

      let listId: string | null = null;
      if (entry.created.length > 0) {
        const first = entry.created[0].payload.row!;
        await tx.update(priceList).set({ status: "superseded" }).where(and(eq(priceList.brandId, b.id), eq(priceList.status, "published")));
        const [list] = await tx
          .insert(priceList)
          .values({
            brandId: b.id,
            label: first.listLabel,
            effectiveFrom: first.effectiveFrom,
            sourceFileId: job.sourceFileId,
            referenceFileId: job.referenceFileId,
            status: "published",
            importJobId: job.id,
            importedBy: actorId,
            importedAt: now,
          })
          .returning({ id: priceList.id });
        listId = list.id;
        result.priceListIds.push(list.id);

        const missing: { name: string }[] = [];
        for (const r of entry.created) {
          for (const name of r.payload.row!.designs) {
            const key = nameKey(name);
            if (!designId.has(key) && !missing.some((m) => nameKey(m.name) === key)) missing.push({ name });
          }
        }
        for (const part of chunks(missing)) {
          const inserted = await tx.insert(design).values(part.map((m) => ({ brandId: b.id, name: m.name }))).returning({ id: design.id, name: design.name });
          for (const d of inserted) designId.set(nameKey(d.name), d.id);
        }

        // Price groups (ids chosen here so the design links can be inserted in bulk).
        const groups = entry.created.map((r, index) => ({ id: randomUUID(), row: r.payload.row!, index }));
        for (const part of chunks(groups)) {
          await tx.insert(priceGroup).values(
            part.map((g) => ({
              id: g.id,
              priceListId: list.id,
              sizeLabel: g.row.size,
              lengthMm: g.row.lengthMm,
              widthMm: g.row.widthMm,
              finish: g.row.finish,
              piecesPerBox: g.row.piecesPerBox,
              sqftPerBox: g.row.sqftPerBox,
              ratePerBox: g.row.ratePerBox,
              ratePerSqft: g.row.ratePerSqft,
              sortOrder: g.index,
            })),
          );
        }
        const links = groups.flatMap((g) => g.row.designs.map((name) => ({ priceGroupId: g.id, designId: designId.get(nameKey(name))! })));
        for (const part of chunks(links, 1000)) await tx.insert(priceGroupDesign).values(part);

        // Products: update the ones that exist, create the rest.
        const existingProducts = await tx.select().from(product).where(eq(product.brandId, b.id));
        const productByKey = new Map<string, (typeof existingProducts)[number]>();
        for (const p of existingProducts) {
          if (p.designId && p.sizeLabel) productByKey.set(`${p.designId}|${nameKey(p.sizeLabel)}|${nameKey(p.finish ?? "")}`, p);
        }
        const updates: ProductUpdate[] = [];
        const created: (typeof product.$inferInsert)[] = [];
        for (const g of groups) {
          for (const name of g.row.designs) {
            const dId = designId.get(nameKey(name))!;
            const existing = productByKey.get(`${dId}|${nameKey(g.row.size)}|${nameKey(g.row.finish)}`);
            if (existing) {
              const cost = costForUnit(existing.unit, g.row);
              const changed = existing.costPerUnit !== null && !dec(existing.costPerUnit).eq(cost);
              if (changed) {
                result.costChanges++;
                auditRows.push({
                  userId: actorId,
                  entityType: "product",
                  entityId: existing.id,
                  action: "cost_change",
                  note: `Cost ${existing.costPerUnit} -> ${cost} (price list import; selling price not changed)`,
                });
              }
              updates.push({
                id: existing.id,
                priceGroupId: g.id,
                cost,
                previousCost: changed ? existing.costPerUnit : existing.previousCostPerUnit,
                review: changed || existing.costReviewNeeded,
                margin: marginFromPrice(cost, existing.sellingPricePerUnit),
                pieces: g.row.piecesPerBox,
                sqft: g.row.sqftPerBox,
              });
            } else {
              created.push({
                name: `${name} ${g.row.size} ${g.row.finish}`,
                brandId: b.id,
                designId: dId,
                priceGroupId: g.id,
                sizeLabel: g.row.size,
                finish: g.row.finish,
                unit: "box",
                piecesPerBox: g.row.piecesPerBox,
                sqftPerBox: g.row.sqftPerBox,
                hsnCode: g.row.hsnCode ?? job.defaults.hsnCode,
                gstRate: job.defaults.gstRate,
                costPerUnit: costForUnit("box", g.row),
              });
            }
          }
        }
        for (const part of chunks(created)) await tx.insert(product).values(part);
        result.newProducts += created.length;
        for (const part of chunks(updates, 200)) {
          const values = sql.join(
            part.map((u) => sql`(${u.id}::uuid, ${u.priceGroupId}::uuid, ${u.cost}::numeric, ${u.previousCost}::numeric, ${u.review}::boolean, ${u.margin}::numeric, ${u.pieces}::integer, ${u.sqft}::numeric)`),
            sql`, `,
          );
          await tx.execute(sql`
            UPDATE product AS p SET
              price_group_id = v.price_group_id, cost_per_unit = v.cost, previous_cost_per_unit = v.previous_cost,
              cost_review_needed = v.review, margin_percent = v.margin, pieces_per_box = v.pieces, sqft_per_box = v.sqft, updated_at = now()
            FROM (VALUES ${values}) AS v(id, price_group_id, cost, previous_cost, review, margin, pieces, sqft)
            WHERE p.id = v.id`);
        }
        auditRows.push({
          userId: actorId,
          entityType: "price_list",
          entityId: listId,
          action: "create",
          toStatus: "published",
          note: `${b.name} ${first.listLabel ?? first.effectiveFrom}: ${groups.length} groups, ${created.length} new products, ${updates.filter((u) => u.review).length} awaiting selling-price review`,
        });
      }

      // Designs the owner chose to discontinue because the new list no longer has them.
      for (const r of entry.removed) {
        const row = r.payload.row!;
        const ids = row.designs.map((n) => designId.get(nameKey(n))).filter((x): x is string => Boolean(x));
        if (ids.length === 0) continue;
        const candidates = await tx.select().from(product).where(and(eq(product.brandId, b.id), inArray(product.designId, ids), eq(product.status, "active")));
        for (const p of candidates) {
          if (nameKey(p.sizeLabel ?? "") !== nameKey(row.size) || nameKey(p.finish ?? "") !== nameKey(row.finish)) continue;
          await tx.update(product).set({ status: "discontinued" }).where(eq(product.id, p.id));
          result.discontinued++;
          auditRows.push({ userId: actorId, entityType: "product", entityId: p.id, action: "status_change", fromStatus: "active", toStatus: "discontinued", note: "Not in the new price list (import approval)" });
        }
      }
    }

    await tx.update(importJob).set({ status: "approved", approvedBy: actorId, approvedAt: now }).where(eq(importJob.id, jobId));
    auditRows.push({
      userId: actorId,
      entityType: "import_job",
      entityId: jobId,
      action: "status_change",
      fromStatus: "needs_review",
      toStatus: "approved",
      note: `${result.priceListIds.length} price list(s), ${result.newProducts} new products, ${result.costChanges} cost changes, ${result.discontinued} discontinued`,
    });
    for (const part of chunks(auditRows, 500)) await tx.insert(auditLog).values(part);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Products: selling price and margin, discontinuing
// ---------------------------------------------------------------------------

const MONEY = /^\d+(\.\d{1,2})?$/;
const SIGNED = /^-?\d+(\.\d{1,2})?$/;

/**
 * Sets the selling price, either directly or as a margin on cost; the other value is derived so they never disagree.
 * Clears the "cost changed, review selling price" flag: setting the price is the review.
 */
export async function updateSellingPrice(
  db: Database,
  actorId: string,
  productId: string,
  input: { price?: string | null; marginPercent?: string | null },
): Promise<{ price: string | null; margin: string | null }> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(product).where(eq(product.id, productId)).for("update");
    if (!p) throw new NotFoundError("That product no longer exists");
    let price: string | null;
    let margin: string | null;
    if (input.price !== undefined) {
      const text = (input.price ?? "").trim();
      if (text === "") {
        price = null;
        margin = null;
      } else {
        if (!MONEY.test(text)) throw new ValidationError("Selling price must be a number with at most 2 decimals", { sellingPricePerUnit: "Enter a number such as 1000 or 1000.50" });
        price = round2(text).toFixed(2);
        margin = marginFromPrice(p.costPerUnit, price);
      }
    } else if (input.marginPercent !== undefined && input.marginPercent !== null && input.marginPercent.trim() !== "") {
      const text = input.marginPercent.trim();
      if (!SIGNED.test(text) || dec(text).lt(-100)) throw new ValidationError("Margin must be a number of at least -100", { marginPercent: "Enter a percentage such as 20" });
      if (p.costPerUnit === null || dec(p.costPerUnit).lte(0)) throw new ValidationError("This product has no cost price, so a margin cannot be applied. Enter the selling price instead.", { marginPercent: "No cost price to apply a margin to" });
      price = priceFromMargin(p.costPerUnit, text);
      margin = marginFromPrice(p.costPerUnit, price);
    } else {
      throw new ValidationError("Enter a selling price or a margin");
    }
    await tx.update(product).set({ sellingPricePerUnit: price, marginPercent: margin, costReviewNeeded: false }).where(eq(product.id, productId));
    await recordAudit(tx, {
      userId: actorId,
      entityType: "product",
      entityId: productId,
      action: "update",
      note: `Selling price ${price ?? "cleared"}${margin !== null ? ` (margin ${margin}% on cost)` : ""}`,
    });
    return { price, margin };
  });
}

/** Discontinued products stay on old quotations but cannot be added to new ones. */
export async function discontinueProduct(db: Database, actorId: string, productId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [p] = await tx.select({ status: product.status }).from(product).where(eq(product.id, productId)).for("update");
    if (!p) throw new NotFoundError("That product no longer exists");
    if (p.status === "discontinued") return;
    await tx.update(product).set({ status: "discontinued" }).where(eq(product.id, productId));
    await recordAudit(tx, { userId: actorId, entityType: "product", entityId: productId, action: "status_change", fromStatus: "active", toStatus: "discontinued" });
  });
}
