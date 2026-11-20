import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "@/db";
import { auditLog, brand, businessProfile, distributor, file, importJob, priceList, product, user } from "@/db/schema";
import { createStaffUser } from "@/lib/auth/create-user";
import { deleteStoredFile } from "@/lib/storage/files";

// Quickstart scenario 6 (US2, SC-003): import the template, review, approve; import a second version with a changed
// rate; the change is flagged and selling prices stay untouched. Runs against the TEST database only.
// Brands are prefixed "E2E I " and uploads "E2E-I-", and everything is removed afterwards.
const suffix = randomBytes(4).toString("hex");
const sales = { name: "E2E I Sales", email: `e2e-i-sales-${suffix}@example.test`, password: `Sales-${randomBytes(9).toString("base64url")}`, role: "sales" as const };
const owner = { name: "E2E I Owner", email: `e2e-i-owner-${suffix}@example.test`, password: `Owner-${randomBytes(9).toString("base64url")}`, role: "owner" as const };
const PREFIX = "E2E I ";
let profileBackup: { id: string; hsn: string | null; gst: string | null } | null = null;
let createdProfile = false;

test.setTimeout(240_000);
const SLOW = { timeout: 60_000 };

/** A CSV fixture with its brand names prefixed, so the run cannot meet real data. */
function fixture(name: string): Buffer {
  const text = readFileSync(path.join(process.cwd(), "tests/fixtures/price-lists", name), "utf8").replace(/^(Bi'mor|colortile|Icon),/gm, `${PREFIX}$1,`);
  return Buffer.from(text);
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

/**
 * The business profile is a single shared row that other spec files (running in parallel) also create and delete,
 * so the import defaults are asserted again right before each upload instead of once at the start.
 */
async function ensureDefaults() {
  const db = getDb();
  const [profile] = await db.select().from(businessProfile).limit(1);
  if (!profile) {
    await db
      .insert(businessProfile)
      .values({ legalName: "E2E I Alpha Tiles", addressLine1: "Shop No. G-4", city: "Pune", state: "Maharashtra", stateCode: "27", defaultHsnCode: "6907", defaultGstRate: "18" })
      .onConflictDoNothing();
    createdProfile = true;
    return;
  }
  if (profile.defaultHsnCode === "6907" && profile.defaultGstRate !== null && Number(profile.defaultGstRate) === 18) return;
  profileBackup ??= { id: profile.id, hsn: profile.defaultHsnCode, gst: profile.defaultGstRate };
  await db.update(businessProfile).set({ defaultHsnCode: "6907", defaultGstRate: "18" }).where(eq(businessProfile.id, profile.id));
}

test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("e2e tests must run against TEST_DATABASE_URL only");
  }
  const db = getDb();
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
  await createStaffUser(sales);
  await createStaffUser(owner);
  await ensureDefaults();
});

test.afterAll(async () => {
  const db = getDb();
  const brands = await db.select({ id: brand.id }).from(brand).where(like(brand.name, `${PREFIX}%`));
  if (brands.length) {
    const ids = brands.map((b) => b.id);
    const products = await db.select({ id: product.id }).from(product).where(inArray(product.brandId, ids));
    const lists = await db.select({ id: priceList.id }).from(priceList).where(inArray(priceList.brandId, ids));
    const entities = [...products.map((p) => p.id), ...lists.map((l) => l.id), ...ids];
    if (entities.length) await db.delete(auditLog).where(inArray(auditLog.entityId, entities));
    await db.delete(product).where(inArray(product.brandId, ids));
    await db.delete(priceList).where(inArray(priceList.brandId, ids));
    await db.delete(brand).where(inArray(brand.id, ids));
  }
  const jobs = await db.select({ id: importJob.id }).from(importJob).where(like(importJob.sourceName, "E2E-I-%"));
  if (jobs.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, jobs.map((j) => j.id)));
    await db.delete(importJob).where(inArray(importJob.id, jobs.map((j) => j.id)));
  }
  for (const f of await db.select({ id: file.id }).from(file).where(like(file.originalName, "E2E-I-%"))) await deleteStoredFile(f.id);
  if (createdProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "E2E I Alpha Tiles"));
  if (profileBackup) await db.update(businessProfile).set({ defaultHsnCode: profileBackup.hsn, defaultGstRate: profileBackup.gst }).where(eq(businessProfile.id, profileBackup.id));
  await db.delete(user).where(inArray(user.email, [sales.email, owner.email]));
});

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

async function upload(page: Page, name: string, bytes: Buffer, reference = false) {
  await ensureDefaults();
  await page.goto("/catalog/import/new");
  await page.locator("#file").setInputFiles({ name, mimeType: "text/csv", buffer: bytes });
  if (reference) await page.locator("#reference").setInputFiles({ name: "E2E-I-fun-enterprises.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("button", { name: "Read and review" }).click();
  await expect(page).toHaveURL(/\/catalog\/import\/[0-9a-f-]{36}$/, SLOW);
}

const summary = (page: Page, label: string) => page.getByLabel("Summary").locator("li", { hasText: new RegExp(`^\\d+ ${label}$`) });
const rows = (page: Page, kind: string) => page.locator(`tr[data-kind="${kind}"]:visible`);

test("import the Fun Enterprises list, then a second version with one changed rate", async ({ page }) => {
  await signIn(page, sales);

  // --- first import: nine rows, all new, with the original PDF attached -------------------------------------------
  await upload(page, "E2E-I-fun-2026-08-01.csv", fixture("fun-enterprises-2026-08-01.csv"), true);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E-I-fun-2026-08-01.csv");
  await expect(summary(page, "new")).toHaveText("9 new");
  await expect(summary(page, "error")).toHaveText("0 error");
  await expect(rows(page, "new")).toHaveCount(9);
  await expect(page.getByText("New brand, created on approval").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E-I-fun-enterprises.pdf" })).toBeVisible();
  // The page offers the group named in the import contract.
  await expect(page.locator("tr:visible", { hasText: "600 x 600 · 4 pcs, 15.5 sq.ft per box · Rustic Matt" })).toContainText("₹883.50 / box");
  await expect(page.locator("tr:visible", { hasText: "1200 x 600 · 3 pcs, 23.25 sq.ft per box · Glossy" })).toContainText("₹1,209.00 / box");

  // Nothing is in the catalog before Approve.
  const db = getDb();
  expect(await db.select().from(brand).where(like(brand.name, `${PREFIX}%`))).toHaveLength(0);

  await page.getByRole("button", { name: "Approve import" }).click();
  await expect(page.getByText("Import approved").first()).toBeVisible(SLOW);
  await expect(page.getByRole("link", { name: new RegExp(`${PREFIX}colortile`) })).toBeVisible();

  // --- the products exist with cost prices; set a selling price ---------------------------------------------------
  await page.goto(`/catalog/products?q=${encodeURIComponent(`${PREFIX}colortile Imperia Silver`)}`);
  await page.getByRole("link", { name: /Imperia Silver 600 x 600 Rustic Matt/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Imperia Silver 600 x 600 Rustic Matt");
  await expect(page.getByText("₹883.50 per box")).toBeVisible();
  await expect(page.getByLabel("Selling price (₹, ex-GST)")).toHaveValue("");
  await page.getByLabel("Selling price (₹, ex-GST)").fill("1000");
  await expect(page.getByLabel("Margin on cost (%)")).toHaveValue("13.19");
  await page.getByRole("button", { name: "Save selling price" }).click(); // sales staff change only the price
  await expect(page.getByRole("status")).toHaveText("Selling price saved", SLOW);
  const [silver] = await db.select().from(product).where(like(product.name, "Imperia Silver 600 x 600 Rustic Matt")).limit(1);
  expect(silver.sellingPricePerUnit).toBe("1000.00");

  // --- the quotation editor finds it by brand, shows size and finish, and takes the selling price ----------------
  await page.goto("/quotations/new");
  await page.getByLabel("Add product").fill(`${PREFIX}colortile Imperia Silver`);
  const pick = page.getByRole("button", { name: /Imperia Silver 600 x 600 Rustic Matt/ });
  await expect(pick).toContainText(`${PREFIX}colortile · 600 x 600 · Rustic Matt`);
  await expect(pick).toContainText("₹ 1,000.00 / box");
  await pick.click();
  await expect(page.locator('[aria-label="Rate, line 1"]:visible')).toHaveValue("1000");

  // --- second version: one changed rate (883.50 -> 899.00), a new design, a dropped design -------------------------
  await upload(page, "E2E-I-fun-2026-09-revised.csv", fixture("fun-enterprises-2026-09-revised.csv"));
  await expect(summary(page, "changed")).toHaveText("1 changed");
  await expect(summary(page, "new")).toHaveText("1 new"); // Stone gained Parker Sand
  await expect(summary(page, "unchanged")).toHaveText("7 unchanged");
  await expect(summary(page, "removed")).toHaveText("1 removed");
  const changed = rows(page, "changed");
  await expect(changed).toHaveCount(1);
  await expect(changed).toContainText("Rustic Matt");
  await expect(changed).toContainText("₹899.00 / box");
  await changed.locator("summary").first().click();
  await expect(changed).toContainText("was ₹883.50");
  // The dropped design is offered for a decision and stays active by default.
  await expect(page.getByText("No longer in the new list")).toBeVisible();
  await expect(page.getByText("Star white").last()).toBeVisible();
  await expect(page.getByText("Stay active", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Approve import" }).click();
  await expect(page.getByText("Import approved").first()).toBeVisible(SLOW);

  // --- the change is flagged; the selling price is untouched; the old version is still viewable ----------------------
  await page.goto(`/catalog/products/${silver.id}`);
  await expect(page.getByText("Cost changed, review selling price").first()).toBeVisible();
  await expect(page.getByText("₹899.00 per box", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Selling price (₹, ex-GST)")).toHaveValue("1000.00");
  await expect(page.getByLabel("Margin on cost (%)")).toHaveValue("11.23");
  await page.goto("/catalog/products?review=1");
  await expect(page.getByText(/Imperia Silver 600 x 600 Rustic Matt/)).toBeVisible();

  await page.goto("/catalog/price-lists");
  const colortile = page.locator("section:visible", { has: page.getByRole("heading", { name: `${PREFIX}colortile` }) });
  await expect(colortile.getByText("Superseded")).toBeVisible();
  await expect(colortile.getByText("Current")).toBeVisible();
  await expect(colortile.getByText("reference PDF attached")).toBeVisible();
  await colortile.getByRole("link", { name: /Sep 2026/ }).click();
  await expect(page.getByText("was ₹883.50 / box")).toBeVisible();
  await expect(page.getByText("Compared with the previous version")).toContainText("7 changed, 1 new, 1 no longer listed"); // designs, not rows: seven designs share the changed rate
  await page.getByRole("link", { name: /w\.e\.f\. 2026-08-01/ }).first().click();
  await expect(page.getByText("₹883.50").first()).toBeVisible();
  const reference = await page.request.get(`/api/files/${(await db.select().from(priceList).where(eq(priceList.status, "superseded")).limit(50)).find((l) => l.referenceFileId)!.referenceFileId}`);
  expect(reference.status()).toBe(200);
  expect(reference.headers()["content-disposition"]).toMatch(/^attachment/);

  // Setting the price is the review: the flag clears.
  await page.goto(`/catalog/products/${silver.id}`);
  await page.getByRole("button", { name: "Save selling price" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Selling price saved" })).toBeVisible(SLOW);
  await page.goto(`/catalog/products/${silver.id}`);
  await expect(page.getByText("Cost changed, review selling price")).toHaveCount(0);
});

test("the Icon list: a wrong rate row is reported, fixed in review, and a group keeps its two price rows", async ({ page }) => {
  await signIn(page, sales);
  await upload(page, "E2E-I-icon-r6-1.csv", fixture("icon-shco-r6-1.csv"));
  await expect(summary(page, "new")).toHaveText("6 new");
  await expect(summary(page, "error")).toHaveText("1 error");

  const bad = rows(page, "error");
  await expect(bad).toHaveCount(1);
  await expect(bad).toContainText("does not match rate per box");
  await expect(bad).toContainText("Fix first");
  // Matt & Rustic shows both price rows.
  await expect(page.locator("tr:visible", { hasText: "Matt & Rustic" })).toHaveCount(2);
  await expect(page.locator("tr:visible", { hasText: "₹899.00 / box" })).toBeVisible();
  await expect(page.locator("tr:visible", { hasText: "₹930.00 / box" })).toBeVisible();
  // The repeated Kalakriti designs are collapsed with a warning.
  await expect(page.getByText(/Warning: Repeated in this row and counted once: Canis, Propus/)).toBeVisible();

  // Fix the wrong sq.ft rate (98 -> 89) in the review.
  await bad.getByText("Fix values").click();
  await bad.getByLabel("Rate per sq.ft").fill("89");
  await bad.getByRole("button", { name: "Save and check again" }).click();
  await expect(summary(page, "error")).toHaveText("0 error", SLOW);
  await expect(summary(page, "new")).toHaveText("7 new");

  // Skip one row, approve the rest.
  await page.locator("tr:visible", { hasText: "Kalakriti" }).getByRole("button", { name: "Skip" }).click();
  await expect(page.locator("tr:visible", { hasText: "Kalakriti" })).toContainText("Skipped", SLOW);
  await page.getByRole("button", { name: "Approve import" }).click();
  await expect(page.getByText("Import approved").first()).toBeVisible(SLOW);
  await expect(page.getByRole("link", { name: new RegExp(`${PREFIX}Icon R6.1`) })).toBeVisible();

  await page.getByRole("link", { name: new RegExp(`${PREFIX}Icon R6.1`) }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("R6.1 · w.e.f. 2026-09-07");
  await expect(page.getByText("This is the first version")).toBeVisible();
  await expect(page.locator("h2:visible", { hasText: "Surface Zero Collection" })).toHaveCount(1);
  await expect(page.locator("h2:visible", { hasText: "Kalakriti" })).toHaveCount(0);
});

test("an unreadable file is reported on the review page, and the owner manages brands while sales only view them", async ({ page }) => {
  await signIn(page, sales);
  await upload(page, "E2E-I-wrong.csv", Buffer.from("name,price\nTile,100\n"));
  const failure = page.getByRole("alert").filter({ hasText: "missing required column" });
  await expect(failure).toContainText("brand");

  await page.goto("/catalog/brands");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Brands and distributors");
  await expect(page.getByRole("button", { name: "Add brand" })).toHaveCount(0);

  // Owner: add a distributor and a brand under it.
  await page.context().clearCookies();
  await signIn(page, owner);
  await page.goto("/catalog/brands");
  await page.locator("#distributor-name").fill(`${PREFIX}Distributor ${suffix}`);
  await page.getByRole("button", { name: "Add distributor" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Distributor added" })).toBeVisible(SLOW);
  await page.locator("#brand-name").fill(`${PREFIX}Brand ${suffix}`);
  await page.locator("#brand-distributor").selectOption({ label: `${PREFIX}Distributor ${suffix}` });
  await page.getByRole("button", { name: "Add brand" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Brand added" })).toBeVisible(SLOW);
  await expect(page.getByRole("heading", { name: new RegExp(`${PREFIX}Distributor ${suffix}`) })).toBeVisible();
  await expect(page.getByText(`${PREFIX}Brand ${suffix}`).first()).toBeVisible();
  // A duplicate brand name is refused.
  await page.locator("#brand-name").fill(`${PREFIX}BRAND ${suffix}`);
  await page.getByRole("button", { name: "Add brand" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible(SLOW);

  const db = getDb();
  await db.delete(brand).where(like(brand.name, `${PREFIX}Brand ${suffix}`));
  await db.delete(distributor).where(like(distributor.name, `${PREFIX}Distributor ${suffix}`));
});
