import { readFileSync } from "node:fs";
import path from "node:path";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  brand,
  businessProfile,
  customer,
  design,
  file,
  importJob,
  importRow,
  numberSeries,
  priceGroup,
  priceGroupDesign,
  priceList,
  product,
  quotation,
  quotationLine,
  user,
} from "@/db/schema";
import { ConflictError, ValidationError } from "@/lib/errors";
import { DEFAULT_FORMATS } from "@/lib/numbering";
import {
  approveImportJob,
  correctImportRow,
  createImportJob,
  discontinueProduct,
  setImportRowAccepted,
  updateSellingPrice,
} from "@/server/catalog-core";
import { getQuotationDetail } from "@/server/quotation-queries";
import { issueQuotation, saveDraft } from "@/server/quotation-core";
import { closeTestDb, getTestDb, hasTestDb } from "./helpers";

// Needs the TEST database (see numbering.test.ts). Brands, customers and files use the ZZIMPORT prefix and a
// financial year in the 2090s, and are removed afterwards. The fixtures keep the distributors' real brand names,
// so each test file is read with those names prefixed.
const suite = hasTestDb() ? describe : describe.skip;
if (!hasTestDb()) {
  console.warn("[integration] SKIPPED price-list-import.test.ts: TEST_DATABASE_URL is not set (see .env.example)");
}

const PREFIX = "ZZIMPORT ";
const NOW = new Date("2096-06-15T10:00:00+05:30");
const DEFAULTS = { hsnCode: "6907", gstRate: "18" };

const BIMOR = `${PREFIX}Bi'mor`;
const COLORTILE = `${PREFIX}colortile`;
const ICON = `${PREFIX}Icon`;

/** A fixture as CSV bytes with the brand names prefixed (and optional text edits) so it cannot meet real data. */
function fixture(name: string, edits: [string | RegExp, string][] = []): Buffer {
  let text = readFileSync(path.join(process.cwd(), "tests/fixtures/price-lists", name), "utf8");
  text = text.replace(/^(Bi'mor|colortile|Icon),/gm, `${PREFIX}$1,`);
  for (const [from, to] of edits) text = text.replace(from, to);
  return Buffer.from(text);
}

let actorId: string;
let customerId: string;
const jobIds: string[] = [];

async function cleanup() {
  const db = await getTestDb();
  const customers = await db.select({ id: customer.id }).from(customer).where(like(customer.displayName, `${PREFIX}%`));
  if (customers.length) {
    const ids = customers.map((c) => c.id);
    const quotes = await db.select({ id: quotation.id }).from(quotation).where(inArray(quotation.customerId, ids));
    if (quotes.length) {
      await db.delete(auditLog).where(and(eq(auditLog.entityType, "quotation"), inArray(auditLog.entityId, quotes.map((q) => q.id))));
      await db.delete(quotation).where(inArray(quotation.customerId, ids));
    }
    await db.delete(customer).where(inArray(customer.id, ids));
  }
  const brands = await db.select({ id: brand.id }).from(brand).where(like(brand.name, `${PREFIX}%`));
  if (brands.length) {
    const ids = brands.map((b) => b.id);
    const products = await db.select({ id: product.id }).from(product).where(inArray(product.brandId, ids));
    const lists = await db.select({ id: priceList.id }).from(priceList).where(inArray(priceList.brandId, ids));
    const entityIds = [...products.map((p) => p.id), ...lists.map((l) => l.id)];
    if (entityIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, entityIds));
    await db.delete(product).where(inArray(product.brandId, ids));
    await db.delete(priceList).where(inArray(priceList.brandId, ids)); // groups and their design links go with it
    await db.delete(brand).where(inArray(brand.id, ids)); // designs go with it
  }
  const jobs = await db.select({ id: importJob.id }).from(importJob).where(like(importJob.sourceName, `${PREFIX}%`));
  if (jobs.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, jobs.map((j) => j.id)));
    await db.delete(importJob).where(inArray(importJob.id, jobs.map((j) => j.id))); // rows go with it
  }
  await db.delete(file).where(like(file.originalName, `${PREFIX}%`));
  await db.delete(user).where(like(user.email, "zztest-import-%"));
  await db.delete(numberSeries).where(eq(numberSeries.financialYear, "2096-97"));
}

async function startJob(name: string, bytes: Buffer, extra: Partial<Parameters<typeof createImportJob>[2]> = {}) {
  const db = await getTestDb();
  const { jobId } = await createImportJob(db, actorId, { fileName: `${PREFIX}${name}`, bytes, defaults: DEFAULTS, ...extra });
  jobIds.push(jobId);
  return jobId;
}

async function rowsOf(jobId: string) {
  const db = await getTestDb();
  return db.select().from(importRow).where(eq(importRow.jobId, jobId)).orderBy(asc(importRow.rowNumber), asc(importRow.kind));
}

async function productsOf(brandName: string) {
  const db = await getTestDb();
  const [b] = await db.select().from(brand).where(eq(brand.name, brandName));
  const rows = await db
    .select({ p: product, designName: design.name })
    .from(product)
    .innerJoin(design, eq(design.id, product.designId))
    .where(eq(product.brandId, b.id));
  return new Map(rows.map((r) => [r.designName, r.p]));
}

let createdBusinessProfile = false;

suite("price-list import (real Postgres)", () => {
  beforeAll(async () => {
    await cleanup();
    const db = await getTestDb();
    const [profile] = await db.select({ id: businessProfile.id }).from(businessProfile).limit(1);
    if (!profile) {
      await db.insert(businessProfile).values({ legalName: "ZZTEST Alpha Tiles", addressLine1: "Shop 4", city: "Pune", state: "Maharashtra", stateCode: "27" });
      createdBusinessProfile = true;
    }
    await db.insert(numberSeries).values({ series: "quotation", financialYear: "2096-97", format: DEFAULT_FORMATS.quotation, lastValue: 0 });
    const [u] = await db.insert(user).values({ name: "ZZTEST importer", email: `zztest-import-${Date.now()}@example.test`, role: "sales" }).returning({ id: user.id });
    actorId = u.id;
    const [c] = await db.insert(customer).values({ type: "company", displayName: `${PREFIX}Radius 9`, stateCode: "27" }).returning({ id: customer.id });
    customerId = c.id;
  });

  afterAll(async () => {
    await cleanup();
    const db = await getTestDb();
    if (createdBusinessProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "ZZTEST Alpha Tiles"));
    await closeTestDb();
  });

  describe("first import of the Fun Enterprises list (Bi'mor + colortile)", () => {
    let jobId: string;

    it("parses into a review with every row new, and saves nothing to the catalog yet", async () => {
      const db = await getTestDb();
      jobId = await startJob("fun-v1.csv", fixture("fun-enterprises-2026-08-01.csv"));
      const [job] = await db.select().from(importJob).where(eq(importJob.id, jobId));
      expect(job.status).toBe("needs_review");
      expect(job.rowCount).toBe(9);

      const rows = await rowsOf(jobId);
      expect(rows).toHaveLength(9);
      expect(rows.every((r) => r.kind === "new")).toBe(true);
      expect(rows.every((r) => r.accepted)).toBe(true); // new rows start accepted; the person can skip them
      expect(rows[0].payload.brandIsNew).toBe(true);

      // Nothing before Approve.
      expect(await db.select().from(brand).where(like(brand.name, `${PREFIX}%`))).toHaveLength(0);
      expect(await db.select().from(priceList).where(eq(priceList.importJobId, jobId))).toHaveLength(0);
    });

    it("approval creates one published price list per brand with its groups, designs and products", async () => {
      const db = await getTestDb();
      const result = await approveImportJob(db, actorId, jobId, NOW);
      expect(result.priceListIds).toHaveLength(2);

      const lists = await db.select().from(priceList).where(eq(priceList.importJobId, jobId));
      expect(lists.map((l) => l.status)).toEqual(["published", "published"]);
      expect(lists.every((l) => l.effectiveFrom === "2026-08-01")).toBe(true);

      const groups = await db.select().from(priceGroup).where(inArray(priceGroup.priceListId, lists.map((l) => l.id)));
      expect(groups).toHaveLength(9);
      const rustic = groups.find((g) => g.finish === "Rustic Matt")!;
      expect(rustic).toMatchObject({ sizeLabel: "600 x 600", piecesPerBox: 4, ratePerBox: "883.50", ratePerSqft: "57.00" });
      expect(Number(rustic.sqftPerBox)).toBe(15.5);
      const glossy = groups.find((g) => g.finish === "Glossy")!;
      expect(glossy).toMatchObject({ sizeLabel: "1200 x 600", piecesPerBox: 3, ratePerBox: "1209.00", ratePerSqft: "52.00" });

      const [job] = await db.select().from(importJob).where(eq(importJob.id, jobId));
      expect(job.status).toBe("approved");
      expect(job.approvedBy).toBe(actorId);

      const links = await db.select().from(priceGroupDesign).where(eq(priceGroupDesign.priceGroupId, rustic.id));
      expect(links).toHaveLength(8);
    });

    it("created a product per design with cost from the group, HSN and GST from the defaults, and no selling price", async () => {
      const products = await productsOf(COLORTILE);
      const silver = products.get("Imperia Silver")!;
      expect(silver).toMatchObject({
        unit: "box",
        sizeLabel: "600 x 600",
        finish: "Rustic Matt",
        piecesPerBox: 4,
        costPerUnit: "883.50",
        hsnCode: "6907",
        status: "active",
        costReviewNeeded: false,
      });
      expect(Number(silver.gstRate)).toBe(18);
      expect(Number(silver.sqftPerBox)).toBe(15.5);
      expect(silver.sellingPricePerUnit).toBeNull();
      expect(silver.marginPercent).toBeNull();
      expect(silver.priceGroupId).not.toBeNull();
      expect(silver.name).toContain("Imperia Silver");
      expect(silver.name).toContain("600 x 600");
      // 8 + 5 + 4 + 4 + 5 + 4 designs for colortile, 6 + 6 + 5 for Bi'mor.
      expect(products.size).toBe(8 + 5 + 4 + 4 + 5 + 4);
      // Calico Crema Endless is printed under both Glossy and Carving: one design, two products.
      const db = await getTestDb();
      const [bimor] = await db.select().from(brand).where(eq(brand.name, BIMOR));
      expect(await db.select().from(product).where(eq(product.brandId, bimor.id))).toHaveLength(6 + 6 + 5);
      expect(await db.select().from(design).where(eq(design.brandId, bimor.id))).toHaveLength(6 + 6 + 5 - 1);
    });

    it("refuses to approve the same import twice", async () => {
      const db = await getTestDb();
      await expect(approveImportJob(db, actorId, jobId, NOW)).rejects.toThrow(ConflictError);
    });
  });

  describe("second version with a changed rate", () => {
    let silverId: string;
    let jobId: string;
    let lineId: string;

    beforeAll(async () => {
      const db = await getTestDb();
      // The owner has set a selling price (margin follows) and quoted the product.
      const silver = (await productsOf(COLORTILE)).get("Imperia Silver")!;
      silverId = silver.id;
      await updateSellingPrice(db, actorId, silverId, { price: "1000" });
      const { id } = await saveDraft(
        db,
        actorId,
        {
          customerId,
          quotationDate: "2096-06-15",
          validUntil: "2096-06-30",
          billTo: { name: `${PREFIX}Radius 9`, gstin: null, address: "Pune", stateCode: "27" },
          shipTo: { name: `${PREFIX}Radius 9`, address: "Pune", stateCode: "27", contactName: null, contactPhone: null },
          layout: "gst_quotation",
          terms: "Payment 100% Advance.",
          advanceAmount: "0",
          notes: null,
          lines: [
            { kind: "product", productId: silverId, description: silver.name, hsnCode: "6907", unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", quantity: "10", rate: "1000.00", discountPercent: "0", gstRate: "18" },
          ],
        },
        NOW,
      );
      await issueQuotation(db, actorId, id, NOW);
      const detail = await getQuotationDetail(db, id);
      lineId = detail!.lines[0].id;
    });

    it("setting a selling price keeps margin on cost consistent", async () => {
      const silver = (await productsOf(COLORTILE)).get("Imperia Silver")!;
      expect(silver.sellingPricePerUnit).toBe("1000.00");
      expect(silver.marginPercent).toBe("13.19"); // (1000 - 883.50) / 883.50
    });

    it("classifies rows: changed rate, new design, unchanged groups, and the dropped design as removed", async () => {
      jobId = await startJob("fun-v2.csv", fixture("fun-enterprises-2026-09-revised.csv"));
      const rows = await rowsOf(jobId);
      const byFinish = (finish: string, brandName = COLORTILE) => rows.find((r) => r.kind !== "removed" && r.payload.row?.finish === finish && r.payload.row.brand === brandName)!;

      expect(byFinish("Rustic Matt").kind).toBe("changed");
      expect(byFinish("Rustic Matt").payload.designs.every((d) => d.kind === "changed" && d.previousRatePerBox === "883.50")).toBe(true);
      expect(byFinish("Stone").kind).toBe("new"); // Parker Sand is new, the other four unchanged
      expect(byFinish("Stone").payload.designs.map((d) => d.kind)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged", "unchanged", "new"]);
      expect(byFinish("Texture Matt").kind).toBe("unchanged");
      expect(byFinish("Glossy", BIMOR).kind).toBe("unchanged");

      const removed = rows.filter((r) => r.kind === "removed");
      expect(removed).toHaveLength(1);
      expect(removed[0].payload.row).toMatchObject({ brand: COLORTILE, finish: "Rustic Matt", designs: ["Star white"] });
      expect(removed[0].accepted).toBe(false); // never auto-discontinued
    });

    it("approval publishes a new version, supersedes the old one, and flags changed costs without touching selling prices", async () => {
      const db = await getTestDb();
      await approveImportJob(db, actorId, jobId, NOW);

      const [b] = await db.select().from(brand).where(eq(brand.name, COLORTILE));
      const lists = await db.select().from(priceList).where(eq(priceList.brandId, b.id)).orderBy(asc(priceList.effectiveFrom));
      expect(lists.map((l) => [l.effectiveFrom, l.status, l.label])).toEqual([
        ["2026-08-01", "superseded", null],
        ["2026-09-01", "published", "Sep 2026"],
      ]);

      const products = await productsOf(COLORTILE);
      const silver = products.get("Imperia Silver")!;
      expect(silver.costPerUnit).toBe("899.00");
      expect(silver.previousCostPerUnit).toBe("883.50");
      expect(silver.costReviewNeeded).toBe(true);
      expect(silver.sellingPricePerUnit).toBe("1000.00"); // untouched
      expect(silver.marginPercent).toBe("11.23"); // follows the new cost: (1000 - 899) / 899

      // Unchanged costs are not flagged; the new design is created; the removed design stays active.
      expect(products.get("Parker Bianco")!.costReviewNeeded).toBe(false);
      expect(products.get("Parker Sand")).toBeDefined();
      expect(products.get("Star white")!.status).toBe("active");
      expect(products.get("Star white")!.costReviewNeeded).toBe(false);

      // Products now point at the current version's groups.
      const [currentGroup] = await db.select().from(priceGroup).where(eq(priceGroup.id, silver.priceGroupId!));
      expect(currentGroup.priceListId).toBe(lists[1].id);
    });

    it("keeps the earlier version readable with its old rates", async () => {
      const db = await getTestDb();
      const [b] = await db.select().from(brand).where(eq(brand.name, COLORTILE));
      const [oldList] = await db.select().from(priceList).where(and(eq(priceList.brandId, b.id), eq(priceList.status, "superseded")));
      const groups = await db.select().from(priceGroup).where(eq(priceGroup.priceListId, oldList.id));
      expect(groups.find((g) => g.finish === "Rustic Matt")!.ratePerBox).toBe("883.50");
      const links = await db
        .select({ name: design.name })
        .from(priceGroupDesign)
        .innerJoin(design, eq(design.id, priceGroupDesign.designId))
        .innerJoin(priceGroup, eq(priceGroup.id, priceGroupDesign.priceGroupId))
        .where(and(eq(priceGroup.priceListId, oldList.id), eq(priceGroup.finish, "Rustic Matt")));
      expect(links.map((l) => l.name)).toContain("Star white");
    });

    it("leaves an issued quotation line exactly as it was", async () => {
      const db = await getTestDb();
      const [line] = await db.select().from(quotationLine).where(eq(quotationLine.id, lineId));
      expect(line.rate).toBe("1000.00");
      expect(line.productId).toBe(silverId);
      expect(line.hsnCode).toBe("6907");
    });

    it("setting the selling price afterwards clears the review flag; margin can set the price instead", async () => {
      const db = await getTestDb();
      await updateSellingPrice(db, actorId, silverId, { marginPercent: "20" });
      const [p] = await db.select().from(product).where(eq(product.id, silverId));
      expect(p.sellingPricePerUnit).toBe("1078.80"); // 899 x 1.20
      expect(p.marginPercent).toBe("20.00");
      expect(p.costReviewNeeded).toBe(false);
      // The quotation line still says 1000.00.
      const [line] = await db.select().from(quotationLine).where(eq(quotationLine.id, lineId));
      expect(line.rate).toBe("1000.00");
    });

    it("an owner can mark a removed design's product discontinued when approving a later list", async () => {
      const db = await getTestDb();
      // Third list: the September list without Parker Sand again; the removed row is accepted this time.
      const third = await startJob("fun-v3.csv", fixture("fun-enterprises-2026-09-revised.csv", [["; Parker Sand", ""], [/Sep 2026/g, "Oct 2026"], [/2026-09-01/g, "2026-10-01"]]));
      const rows = await rowsOf(third);
      const removed = rows.filter((r) => r.kind === "removed");
      expect(removed.map((r) => r.payload.row?.designs)).toEqual([["Parker Sand"]]);
      await setImportRowAccepted(db, actorId, removed[0].id, true);
      await approveImportJob(db, actorId, third, NOW);
      const products = await productsOf(COLORTILE);
      expect(products.get("Parker Sand")!.status).toBe("discontinued");
      expect(products.get("Parker Bianco")!.status).toBe("active");
    });

    it("discontinuing by hand is recorded and does not touch quotation lines", async () => {
      const db = await getTestDb();
      await discontinueProduct(db, actorId, silverId);
      const [p] = await db.select().from(product).where(eq(product.id, silverId));
      expect(p.status).toBe("discontinued");
      const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityId, silverId), eq(auditLog.action, "status_change")));
      expect(audit.length).toBeGreaterThan(0);
      const [line] = await db.select().from(quotationLine).where(eq(quotationLine.id, lineId));
      expect(line.rate).toBe("1000.00");
    });
  });

  describe("Icon list: a group with two price rows, a wrong rate row, skipping and fixing", () => {
    let jobId: string;

    it("reads the wrong rate row as an error that cannot be accepted", async () => {
      jobId = await startJob("icon.csv", fixture("icon-shco-r6-1.csv"));
      const rows = await rowsOf(jobId);
      const errors = rows.filter((r) => r.kind === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/rate per sq\.ft/i);
      expect(errors[0].rowNumber).toBe(8);
      expect(errors[0].accepted).toBe(false);
      const db = await getTestDb();
      await expect(setImportRowAccepted(db, actorId, errors[0].id, true)).rejects.toThrow(ValidationError);
    });

    it("warns about the repeated Kalakriti designs but keeps the row", async () => {
      const rows = await rowsOf(jobId);
      const kalakriti = rows.find((r) => r.payload.row?.finish === "Kalakriti")!;
      expect(kalakriti.kind).toBe("new");
      expect(kalakriti.payload.warnings.join(" ")).toMatch(/Canis/);
      expect(kalakriti.payload.row!.designs).toHaveLength(7);
    });

    it("lets the person fix the wrong row in review, and skip another", async () => {
      const db = await getTestDb();
      const rows = await rowsOf(jobId);
      const bad = rows.find((r) => r.kind === "error")!;
      await correctImportRow(db, actorId, bad.id, { ...bad.raw, rate_per_sqft: "89" });
      const fixed = (await rowsOf(jobId)).find((r) => r.id === bad.id)!;
      expect(fixed.kind).toBe("new");
      expect(fixed.payload.row?.ratePerSqft).toBe("89.00");

      await setImportRowAccepted(db, actorId, fixed.id, true);
      const kalakriti = (await rowsOf(jobId)).find((r) => r.payload.row?.finish === "Kalakriti")!;
      await setImportRowAccepted(db, actorId, kalakriti.id, false);
    });

    it("approves only accepted rows: Matt & Rustic keeps its two prices as two groups, a new brand is created", async () => {
      const db = await getTestDb();
      await approveImportJob(db, actorId, jobId, NOW);
      const [b] = await db.select().from(brand).where(eq(brand.name, ICON));
      expect(b).toBeDefined();
      const [list] = await db.select().from(priceList).where(eq(priceList.brandId, b.id));
      expect(list).toMatchObject({ label: "R6.1", effectiveFrom: "2026-09-07", status: "published" });
      const groups = await db.select().from(priceGroup).where(eq(priceGroup.priceListId, list.id)).orderBy(asc(priceGroup.sortOrder));
      expect(groups).toHaveLength(6); // 7 rows, Kalakriti skipped
      expect(groups.filter((g) => g.finish === "Matt & Rustic").map((g) => [g.ratePerBox, g.ratePerSqft])).toEqual([
        ["899.00", "58.00"],
        ["930.00", "60.00"],
      ]);
      expect(groups.some((g) => g.finish === "Kalakriti")).toBe(false);
      const products = await productsOf(ICON);
      expect(products.get("Elementi Bianco")!.costPerUnit).toBe("899.00");
      expect(products.get("Trust Brown")!.costPerUnit).toBe("930.00");
      expect(products.get("Persian Heriz")!.costPerUnit).toBe("1379.50");
      expect(products.has("Agate")).toBe(false);
      expect(products.get("Angeles")!.costPerUnit).toBe("1007.50"); // Vintigo: sq.ft rate was blank in the file
    });

    it("rejects rows for a different brand than the one the person said the file is for", async () => {
      const db = await getTestDb();
      const [icon] = await db.select().from(brand).where(eq(brand.name, ICON));
      const mismatch = await startJob("fun-for-icon.csv", fixture("fun-enterprises-2026-08-01.csv"), { expectedBrandId: icon.id });
      const rows = await rowsOf(mismatch);
      expect(rows.every((r) => r.kind === "error")).toBe(true);
      expect(rows[0].message).toContain("Icon");
    });
  });

  describe("a 2,000-product list (SC-003)", () => {
    it("is previewed and approved well inside one request, with every row accounted for", async () => {
      const db = await getTestDb();
      const header = "brand,list_label,effective_from,size,pieces_per_box,sqft_per_box,finish,rate_per_box,rate_per_sqft,designs,hsn_code";
      const lines = [header];
      for (let g = 0; g < 400; g++) {
        const designs = Array.from({ length: 5 }, (_, d) => `Bulk Design ${g}-${d}`).join("; ");
        lines.push(`${PREFIX}Bulk,B1,2026-08-01,600 x 600,4,15.50,Finish ${g},${(883.5 + g).toFixed(2)},,${designs},`);
      }
      const started = Date.now();
      const jobId = await startJob("bulk.csv", Buffer.from(lines.join("\n")));
      const previewMs = Date.now() - started;
      const rows = await rowsOf(jobId);
      expect(rows).toHaveLength(400);
      expect(rows.every((r) => r.kind === "new")).toBe(true);
      const approveStarted = Date.now();
      await approveImportJob(db, actorId, jobId, NOW);
      const approveMs = Date.now() - approveStarted;
      expect((await productsOf(`${PREFIX}Bulk`)).size).toBe(2000);
      console.info(`[import] 2,000 designs: preview ${previewMs} ms, approval ${approveMs} ms`);
      // SC-003 allows 10 minutes for import and review; one request must stay far below serverless limits.
      expect(previewMs).toBeLessThan(30_000);
      expect(approveMs).toBeLessThan(30_000);
    });
  });

  describe("unreadable files", () => {
    it("a file without the required columns fails the job with a message and creates no rows", async () => {
      const db = await getTestDb();
      const jobId = await startJob("bad.csv", Buffer.from("name,price\nTile,100\n"));
      const [job] = await db.select().from(importJob).where(eq(importJob.id, jobId));
      expect(job.status).toBe("failed");
      expect(job.errorSummary).toContain("brand");
      expect(await rowsOf(jobId)).toHaveLength(0);
      await expect(approveImportJob(db, actorId, jobId, NOW)).rejects.toThrow(ConflictError);
    });

    it("a PDF is refused with a pointer to the template; it is only ever a reference attachment", async () => {
      const db = await getTestDb();
      const jobId = await startJob("list.pdf", Buffer.from("%PDF-1.4 not read"));
      const [job] = await db.select().from(importJob).where(eq(importJob.id, jobId));
      expect(job.status).toBe("failed");
      expect(job.errorSummary).toMatch(/xlsx|csv/i);
    });
  });
});
