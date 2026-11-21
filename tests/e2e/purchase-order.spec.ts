import { randomBytes } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "@/db";
import { auditLog, businessProfile, customer, poFile, product, purchaseOrder, quotation, quotationRevision, user } from "@/db/schema";
import { createStaffUser } from "@/lib/auth/create-user";
import { deleteStoredFile } from "@/lib/storage/files";
import { issueQuotation, rejectQuotation, saveDraft, type DraftInput } from "@/server/quotation-core";

// Quickstart scenario 7 (US3): approve a quotation, record a PO with an attachment and one reduced quantity, see the
// difference, open the file through /api/files/[id]; a rejected or expired quotation is blocked. Runs against the TEST
// database only. Everything created here is prefixed "E2E PO " and removed afterwards.
const suffix = randomBytes(4).toString("hex");
const sales = { name: "E2E PO Sales", email: `e2e-po-sales-${suffix}@example.test`, password: `Sales-${randomBytes(9).toString("base64url")}`, role: "sales" as const };
const CUSTOMER = `E2E PO Radius ${suffix}`;
const TILE = `E2E PO ATN 600X600 Plain Ivory ${suffix}`;
const SINK = `E2E PO Sink 24 inch ${suffix}`;
let actorId: string;
let customerId: string;
let tileId: string;
let sinkId: string;
let createdProfile = false;

test.setTimeout(240_000);
const SLOW = { timeout: 60_000 };

// A tiny but real-looking PDF: the server checks the %PDF- signature, not the browser's MIME type.
const PO_PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("e2e tests must run against TEST_DATABASE_URL only");
  }
  const db = getDb();
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
  actorId = (await createStaffUser(sales)).id;
  // Spec files run in parallel and share the one business_profile row: insert only if nobody else just did.
  const inserted = await db
    .insert(businessProfile)
    .values({
      legalName: "E2E PO Alpha Tiles", tradeName: "Alpha Tiles", addressLine1: "Shop No. G-4, The Capital Mall", city: "Pune", state: "Maharashtra", stateCode: "27", gstin: "27ABYFA7430K1ZT",
    })
    .onConflictDoNothing()
    .returning({ id: businessProfile.id });
  createdProfile = inserted.length > 0;
  const [c] = await db.insert(customer).values({ type: "company", displayName: CUSTOMER, stateCode: "27", addressLine1: "Baner", city: "Pune" }).returning({ id: customer.id });
  customerId = c.id;
  const [t, s] = await db
    .insert(product)
    .values([
      { name: TILE, unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", hsnCode: "6907", gstRate: "18", sellingPricePerUnit: "580.00" },
      { name: SINK, unit: "piece", hsnCode: "6910", gstRate: "18", sellingPricePerUnit: "1200.00" },
    ])
    .returning({ id: product.id });
  tileId = t.id;
  sinkId = s.id;
});

test.afterAll(async () => {
  const db = getDb();
  const quotes = await db.select({ id: quotation.id }).from(quotation).where(eq(quotation.customerId, customerId));
  const orders = await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(eq(purchaseOrder.customerId, customerId));
  const files = orders.length ? await db.select({ id: poFile.fileId }).from(poFile).where(inArray(poFile.purchaseOrderId, orders.map((o) => o.id))) : [];
  const entityIds = [...quotes.map((q) => q.id), ...orders.map((o) => o.id)];
  if (entityIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, entityIds));
  await db.delete(purchaseOrder).where(eq(purchaseOrder.customerId, customerId));
  for (const f of files) await deleteStoredFile(f.id); // the stored bytes too, not just the row
  await db.delete(quotation).where(eq(quotation.customerId, customerId));
  await db.delete(customer).where(eq(customer.id, customerId));
  await db.delete(product).where(like(product.name, "E2E PO %"));
  if (createdProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "E2E PO Alpha Tiles"));
  await db.delete(user).where(eq(user.email, sales.email));
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(sales.email);
  await page.getByLabel("Password").fill(sales.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

// Next keeps the previous page of a navigation mounted but hidden, so only visible elements are the page in front.
const field = (page: Page, label: string) => page.locator(`[aria-label="${label}"]:visible`);

/** A sent quotation for 4 boxes of tile (580) and 10 sinks (1,200 less 10%), plus transport. Issued through the domain code. */
async function sentQuotation(): Promise<{ id: string; number: string }> {
  const db = getDb();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const input: DraftInput = {
    customerId,
    quotationDate: today,
    validUntil: new Date(Date.now() + 10 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    billTo: { name: CUSTOMER, gstin: null, address: "Baner, Pune", stateCode: "27" },
    shipTo: { name: CUSTOMER, address: "Baner, Pune", stateCode: "27", contactName: null, contactPhone: null },
    layout: "gst_quotation",
    terms: null,
    advanceAmount: "0",
    notes: null,
    lines: [
      { kind: "product", productId: tileId, description: TILE, hsnCode: "6907", unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", quantity: "4", rate: "580.00", discountPercent: "0", gstRate: "18" },
      { kind: "product", productId: sinkId, description: SINK, hsnCode: "6910", unit: "piece", piecesPerBox: null, sqftPerBox: null, quantity: "10", rate: "1200.00", discountPercent: "10", gstRate: "18" },
      { kind: "charge", chargeTypeId: null, description: "Transport Charges", hsnCode: "8704", unit: "piece", quantity: "1", rate: "550.00", discountPercent: "0", gstRate: "18" },
    ],
  };
  const { id } = await saveDraft(db, actorId, input);
  const { number } = await issueQuotation(db, actorId, id);
  return { id, number };
}

test("approve a quotation, record a PO with a file and one reduced quantity, see the difference, open the file", async ({ page }) => {
  const { id, number } = await sentQuotation();
  await signIn(page);

  // A sent quotation cannot take a PO yet: the action is disabled and says why.
  await page.goto(`/quotations/${id}`);
  await expect(page.locator('[aria-label="Purchase orders"]:visible').getByRole("button", { name: "Record PO" })).toBeDisabled();
  await expect(page.locator('[data-testid="po-blocked-reason"]:visible')).toContainText("approve this one first");
  await page.goto(`/orders/new?quotation=${id}`);
  await expect(page.locator('[data-testid="po-blocked"]:visible')).toContainText("approved quotation");

  // Approve it from the quotation page.
  await page.goto(`/quotations/${id}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator('[aria-label="Purchase orders"]:visible').getByRole("link", { name: "Record PO" })).toBeVisible(SLOW);

  // --- Record PO ---------------------------------------------------------------
  await page.locator('[aria-label="Purchase orders"]:visible').getByRole("link", { name: "Record PO" }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/new\\?quotation=${id}`), SLOW);
  await expect(page.getByRole("heading", { name: "Record customer PO" })).toBeVisible();

  // The charge line is not offered; the two items are prefilled with the quoted quantities.
  await expect(field(page, "Ordered quantity, line 1")).toHaveValue("4");
  await expect(field(page, "Ordered quantity, line 2")).toHaveValue("10");
  await expect(field(page, "Ordered quantity, line 3")).toHaveCount(0);
  await expect(page.locator('[data-testid="difference-1"]:visible')).toHaveText("same as quoted");

  const poNumber = `PO/E2E/${suffix}`;
  await page.locator("#customerPoNumber:visible").fill(poNumber);
  await page.locator("#poDate:visible").fill("2026-11-01");
  await page.locator("#advanceReceived:visible").fill("5000");
  await page.locator("#notes:visible").fill("Deliver after the 5th");
  await page.locator("#files:visible").setInputFiles({ name: "customer-po.pdf", mimeType: "application/pdf", buffer: PO_PDF });
  // One reduced quantity: 3 boxes instead of 4.
  await field(page, "Ordered quantity, line 1").fill("3");
  await expect(page.locator('[data-testid="difference-1"]:visible')).toHaveText("1 box fewer than quoted");
  await page.getByRole("button", { name: "Record PO" }).click();

  // --- The PO page ---------------------------------------------------------------
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, SLOW);
  await expect(page.getByRole("heading", { name: new RegExp(`PO ${poNumber}`) })).toBeVisible();
  await expect(page.getByRole("link", { name: number }).first()).toBeVisible(); // linked back to the quotation
  await expect(page.locator('[data-testid="advance-received"]:visible')).toHaveText("₹ 5,000.00");
  await expect(page.locator('[data-testid="po-line-1"]:visible')).toContainText("3 Box");
  await expect(page.locator('[data-testid="po-line-1"]:visible')).toContainText("4 Box"); // quoted
  await expect(page.locator('[data-testid="po-difference-1"]:visible')).toHaveText("−1");
  await expect(page.locator('[data-testid="po-difference-2"]:visible')).toHaveText("same");
  // 3 x 580 + 10 x 1,080 = 12,540 taxable; 18% GST = 2,257.20
  await expect(page.locator('[data-testid="ordered-value"]:visible')).toHaveText("₹ 14,797.20");
  // Nothing delivered yet: everything ordered is pending (the challan e2e covers deliveries).
  await expect(page.locator('[data-testid="po-delivered-1"]:visible')).toHaveText("0 Box");
  await expect(page.locator('[data-testid="po-pending-1"]:visible')).toHaveText("3 Box");
  await expect(page.getByText("Deliver after the 5th")).toBeVisible();

  // --- The attachment opens through /api/files/[id] ---------------------------------
  const link = page.locator('[aria-label="Attachments"]:visible').getByRole("link", { name: "customer-po.pdf" });
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/api\/files\/[0-9a-f-]{36}$/);
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  // ...and only for signed-in staff.
  const anonymous = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
  expect((await anonymous.request.get(href!)).status()).toBe(401);
  await anonymous.close();

  // --- Listed, and findable by number -------------------------------------------------
  await page.goto(`/orders?po=${encodeURIComponent(poNumber)}`);
  await expect(page.getByRole("link", { name: poNumber })).toBeVisible();
  await page.goto(`/quotations/${id}`);
  await expect(page.locator('[aria-label="Purchase orders"]:visible').getByRole("link", { name: `PO ${poNumber}` })).toBeVisible();
});

test("a duplicate customer PO number asks for confirmation; a wrong file type is refused", async ({ page }) => {
  const first = await sentQuotation();
  const second = await sentQuotation();
  const db = getDb();
  await signIn(page);
  for (const q of [first, second]) {
    await page.goto(`/quotations/${q.id}`);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.locator('[aria-label="Purchase orders"]:visible').getByRole("link", { name: "Record PO" })).toBeVisible(SLOW);
  }

  const poNumber = `PO/DUP/${suffix}`;
  const fill = async (quotationId: string) => {
    await page.goto(`/orders/new?quotation=${quotationId}`);
    await page.locator("#customerPoNumber:visible").fill(poNumber);
  };

  await fill(first.id);
  await page.getByRole("button", { name: "Record PO" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, SLOW);

  // The same number again, with a file that is not a PDF or a picture: the file problem is reported, nothing is recorded.
  await fill(second.id);
  await page.locator("#files:visible").setInputFiles({ name: "po.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ not a document") });
  await page.getByRole("button", { name: "Record PO" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "PDF, or a PNG, JPEG or WebP" }).first()).toBeVisible(SLOW);
  await page.locator("#files:visible").setInputFiles([]);

  // Without the file: the duplicate is called out and a confirmation box appears.
  await page.getByRole("button", { name: "Record PO" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already has a PO" }).first()).toBeVisible(SLOW);
  await expect(page.locator("#customerPoNumber:visible")).toHaveValue(poNumber); // what was typed is kept
  await page.getByLabel(/Record this one anyway/).check();
  await page.getByRole("button", { name: "Record PO" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, SLOW);

  const rows = await db.select().from(purchaseOrder).where(eq(purchaseOrder.quotationId, second.id));
  expect(rows).toHaveLength(1);
  const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, rows[0].id));
  expect(audit.map((a) => a.action).sort()).toEqual(["create", "override"]);
});

test("a rejected or expired quotation cannot take a PO", async ({ page }) => {
  const rejected = await sentQuotation();
  await rejectQuotation(getDb(), actorId, rejected.id, "chose another supplier");
  const expired = await sentQuotation();
  await getDb().update(quotationRevision).set({ quotationDate: "2020-01-01", validUntil: "2020-01-15" }).where(eq(quotationRevision.quotationId, expired.id));

  await signIn(page);
  for (const [q, reason] of [
    [rejected, "was rejected"],
    [expired, "has expired"],
  ] as const) {
    await page.goto(`/quotations/${q.id}`);
    await expect(page.locator('[aria-label="Purchase orders"]:visible').getByRole("button", { name: "Record PO" })).toBeDisabled();
    await expect(page.locator('[data-testid="po-blocked-reason"]:visible')).toContainText(reason);
    await expect(page.locator('[data-testid="po-blocked-reason"]:visible')).toContainText("reinstate");
    await page.goto(`/orders/new?quotation=${q.id}`);
    await expect(page.locator('[data-testid="po-blocked"]:visible')).toContainText(reason);
    await expect(page.locator("#customerPoNumber:visible")).toHaveCount(0); // no form
  }
  expect(await getDb().select({ id: purchaseOrder.id }).from(purchaseOrder).where(inArray(purchaseOrder.quotationId, [rejected.id, expired.id]))).toHaveLength(0);
});
