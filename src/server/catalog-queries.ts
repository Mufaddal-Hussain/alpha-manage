import { and, asc, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { brand, design, distributor, file, importJob, importRow, priceGroup, priceGroupDesign, priceList, product } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { diffAgainstCurrent, type CurrentGroup } from "@/lib/import/price-list-diff";

// Reads for the catalog screens (brands, price lists, import review). Each call authorises first; every signed-in
// staff member may view the catalog (sales view, owner manages).

export async function listDistributorsWithBrands() {
  await requireUser();
  const db = getDb();
  const [distributors, brands, productCounts] = await Promise.all([
    db.select().from(distributor).orderBy(asc(distributor.name)),
    db.select().from(brand).orderBy(asc(brand.name)),
    db.select({ brandId: product.brandId, n: count() }).from(product).where(sql`${product.brandId} is not null`).groupBy(product.brandId),
  ]);
  const counts = new Map(productCounts.map((c) => [c.brandId, c.n]));
  const withCount = brands.map((b) => ({ ...b, productCount: counts.get(b.id) ?? 0 }));
  return {
    distributors: distributors.map((d) => ({ ...d, brands: withCount.filter((b) => b.distributorId === d.id) })),
    unassigned: withCount.filter((b) => b.distributorId === null),
  };
}

export async function listBrandOptions() {
  await requireUser();
  return getDb().select({ id: brand.id, name: brand.name, active: brand.active }).from(brand).orderBy(asc(brand.name));
}

export async function listRecentImportJobs(limit = 10) {
  await requireUser();
  return getDb()
    .select({
      id: importJob.id,
      sourceName: importJob.sourceName,
      status: importJob.status,
      rowCount: importJob.rowCount,
      createdAt: importJob.createdAt,
    })
    .from(importJob)
    .orderBy(desc(importJob.createdAt))
    .limit(limit);
}

export async function getImportJobDetail(jobId: string) {
  await requireUser();
  const db = getDb();
  const [job] = await db.select().from(importJob).where(eq(importJob.id, jobId));
  if (!job) return null;
  const [rows, lists, files, expected] = await Promise.all([
    db.select().from(importRow).where(eq(importRow.jobId, jobId)).orderBy(asc(importRow.rowNumber), asc(importRow.createdAt)),
    db
      .select({ id: priceList.id, label: priceList.label, effectiveFrom: priceList.effectiveFrom, brandName: brand.name })
      .from(priceList)
      .innerJoin(brand, eq(brand.id, priceList.brandId))
      .where(eq(priceList.importJobId, jobId)),
    db
      .select({ id: file.id, originalName: file.originalName })
      .from(file)
      .where(inArray(file.id, [job.sourceFileId, job.referenceFileId].filter((x): x is string => Boolean(x)))),
    job.brandId ? db.select({ name: brand.name }).from(brand).where(eq(brand.id, job.brandId)) : Promise.resolve([]),
  ]);
  const fileName = (id: string | null) => files.find((f) => f.id === id)?.originalName ?? null;
  return {
    job,
    rows,
    lists,
    expectedBrand: expected[0]?.name ?? null,
    sourceFile: job.sourceFileId ? { id: job.sourceFileId, name: fileName(job.sourceFileId) } : null,
    referenceFile: job.referenceFileId ? { id: job.referenceFileId, name: fileName(job.referenceFileId) } : null,
  };
}

export async function listPriceLists() {
  await requireUser();
  const db = getDb();
  const lists = await db
    .select({
      id: priceList.id,
      brandId: priceList.brandId,
      brandName: brand.name,
      label: priceList.label,
      effectiveFrom: priceList.effectiveFrom,
      status: priceList.status,
      importedAt: priceList.importedAt,
      referenceFileId: priceList.referenceFileId,
    })
    .from(priceList)
    .innerJoin(brand, eq(brand.id, priceList.brandId))
    .orderBy(asc(brand.name), desc(priceList.effectiveFrom), desc(priceList.importedAt));
  if (lists.length === 0) return [];
  const ids = lists.map((l) => l.id);
  const [groupCounts, designCounts] = await Promise.all([
    db.select({ listId: priceGroup.priceListId, n: count() }).from(priceGroup).where(inArray(priceGroup.priceListId, ids)).groupBy(priceGroup.priceListId),
    db
      .select({ listId: priceGroup.priceListId, n: count() })
      .from(priceGroupDesign)
      .innerJoin(priceGroup, eq(priceGroup.id, priceGroupDesign.priceGroupId))
      .where(inArray(priceGroup.priceListId, ids))
      .groupBy(priceGroup.priceListId),
  ]);
  const groups = new Map(groupCounts.map((g) => [g.listId, g.n]));
  const designs = new Map(designCounts.map((g) => [g.listId, g.n]));
  return lists.map((l) => ({ ...l, groupCount: groups.get(l.id) ?? 0, designCount: designs.get(l.id) ?? 0 }));
}

async function groupsOf(listId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: priceGroup.id,
      sizeLabel: priceGroup.sizeLabel,
      finish: priceGroup.finish,
      piecesPerBox: priceGroup.piecesPerBox,
      sqftPerBox: priceGroup.sqftPerBox,
      ratePerBox: priceGroup.ratePerBox,
      ratePerSqft: priceGroup.ratePerSqft,
      sortOrder: priceGroup.sortOrder,
      designName: design.name,
    })
    .from(priceGroup)
    .leftJoin(priceGroupDesign, eq(priceGroupDesign.priceGroupId, priceGroup.id))
    .leftJoin(design, eq(design.id, priceGroupDesign.designId))
    .where(eq(priceGroup.priceListId, listId))
    .orderBy(asc(priceGroup.sortOrder), asc(design.name));
  const byId = new Map<string, { id: string; sizeLabel: string; finish: string; piecesPerBox: number; sqftPerBox: string; ratePerBox: string; ratePerSqft: string; designs: string[] }>();
  for (const r of rows) {
    const g = byId.get(r.id) ?? { id: r.id, sizeLabel: r.sizeLabel, finish: r.finish, piecesPerBox: r.piecesPerBox, sqftPerBox: r.sqftPerBox, ratePerBox: r.ratePerBox, ratePerSqft: r.ratePerSqft, designs: [] };
    if (r.designName) g.designs.push(r.designName);
    byId.set(r.id, g);
  }
  return [...byId.values()];
}

/** One price list version with its groups, and how each design compares with the previous version of the same brand. */
export async function getPriceListDetail(id: string) {
  await requireUser();
  const db = getDb();
  const [list] = await db
    .select({
      id: priceList.id,
      brandId: priceList.brandId,
      brandName: brand.name,
      label: priceList.label,
      effectiveFrom: priceList.effectiveFrom,
      status: priceList.status,
      importedAt: priceList.importedAt,
      importJobId: priceList.importJobId,
      sourceFileId: priceList.sourceFileId,
      referenceFileId: priceList.referenceFileId,
    })
    .from(priceList)
    .innerJoin(brand, eq(brand.id, priceList.brandId))
    .where(eq(priceList.id, id));
  if (!list) return null;

  const [previous] = await db
    .select({ id: priceList.id, label: priceList.label, effectiveFrom: priceList.effectiveFrom })
    .from(priceList)
    .where(
      and(
        eq(priceList.brandId, list.brandId),
        or(lt(priceList.effectiveFrom, list.effectiveFrom), and(eq(priceList.effectiveFrom, list.effectiveFrom), lt(priceList.importedAt, list.importedAt))),
      ),
    )
    .orderBy(desc(priceList.effectiveFrom), desc(priceList.importedAt))
    .limit(1);

  const groups = await groupsOf(id);
  let comparison: ReturnType<typeof diffAgainstCurrent> | null = null;
  if (previous) {
    const prevGroups: CurrentGroup[] = (await groupsOf(previous.id)).map((g) => ({
      sizeLabel: g.sizeLabel,
      finish: g.finish,
      piecesPerBox: g.piecesPerBox,
      sqftPerBox: g.sqftPerBox,
      ratePerBox: g.ratePerBox,
      ratePerSqft: g.ratePerSqft,
      designs: g.designs,
    }));
    comparison = diffAgainstCurrent(
      prevGroups,
      groups.map((g) => ({ size: g.sizeLabel, finish: g.finish, piecesPerBox: g.piecesPerBox, sqftPerBox: g.sqftPerBox, ratePerBox: g.ratePerBox, ratePerSqft: g.ratePerSqft, designs: g.designs })),
    );
  }
  const fileIds = [list.sourceFileId, list.referenceFileId].filter((x): x is string => Boolean(x));
  const files = fileIds.length ? await db.select({ id: file.id, originalName: file.originalName }).from(file).where(inArray(file.id, fileIds)) : [];
  return {
    list,
    previous: previous ?? null,
    groups: groups.map((g, i) => ({ ...g, diff: comparison?.rows[i] ?? null })),
    removed: comparison?.removed ?? [],
    sourceFileName: files.find((f) => f.id === list.sourceFileId)?.originalName ?? null,
    referenceFileName: files.find((f) => f.id === list.referenceFileId)?.originalName ?? null,
  };
}
