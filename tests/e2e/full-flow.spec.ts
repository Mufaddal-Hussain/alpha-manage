import { randomBytes } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "@/db";
import { auditLog, businessProfile, customer, deliveryChallan, poFile, product, purchaseOrder, quotation, user } from "@/db/schema";
import { createStaffUser } from "@/lib/auth/create-user";
import { deleteStoredFile } from "@/lib/storage/files";

// T080: the whole sales flow through the screens, the way staff do it: customer -> quotation -> issue -> approve -> PO
// (with the customer's PO file) -> two partial challans -> delivered, with the dashboard and the owner's audit log
// following along and the PDFs and files closed to signed-out requests. Quickstart scenarios 3, 7 and 8 in one run.
// Runs against the TEST database only. Everything created carries "E2E FF" and this run's suffix, and is removed afterwards.
const suffix = randomBytes(4).toString("hex");
const owner = { name: "E2E FF Owner", email: `e2e-ff-owner-${suffix}@example.test`, password: `Owner-${randomBytes(9).toString("base64url")}`, role: "owner" as const };
const CUSTOMER = `E2E FF Buyer ${suffix}`;
const TILE = `E2E FF ATN 600X600 Plain Ivory ${suffix}`;
const PO_NUMBER = `PO/FF/${suffix}`;
let createdProfile = false;

test.setTimeout(300_000);
const SLOW = { timeout: 60_000 };

// A tiny PDF: the server checks the %PDF- signature, not the browser's MIME type.
const PO_PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("e2e tests must run against TEST_DATABASE_URL only");
  }
  const db = getDb();
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
  await createStaffUser(owner);
  // Spec files run in parallel and share the one business_profile row: insert only if nobody else just did.
  const inserted = await db
    .insert(businessProfile)
    .values({ legalName: "E2E FF Alpha Tiles", tradeName: "Alpha Tiles", addressLine1: "Shop No. G-4, The Capital Mall", city: "Pune", state: "Maharashtra", stateCode: "27", gstin: "27ABYFA7430K1ZT" })
    .onConflictDoNothing()
    .returning({ id: businessProfile.id });
  createdProfile = inserted.length > 0;
  await db.insert(product).values({ name: TILE, sizeLabel: "600 x 600", unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", hsnCode: "6907", gstRate: "18", sellingPricePerUnit: "580.00" });
});

test.afterAll(async () => {
  const db = getDb();
  const customers = await db.select({ id: customer.id }).from(customer).where(eq(customer.displayName, CUSTOMER));
  if (customers.length) {
    const ids = customers.map((c) => c.id);
    const quotes = await db.select({ id: quotation.id }).from(quotation).where(inArray(quotation.customerId, ids));
    const orders = await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(inArray(purchaseOrder.customerId, ids));
    const challans = await db.select({ id: deliveryChallan.id }).from(deliveryChallan).where(inArray(deliveryChallan.customerId, ids));
    const files = orders.length ? await db.select({ id: poFile.fileId }).from(poFile).where(inArray(poFile.purchaseOrderId, orders.map((o) => o.id))) : [];
    const entityIds = [...ids, ...quotes.map((q) => q.id), ...orders.map((o) => o.id), ...challans.map((c) => c.id)];
    await db.delete(auditLog).where(inArray(auditLog.entityId, entityIds));
    await db.delete(deliveryChallan).where(inArray(deliveryChallan.customerId, ids));
    await db.delete(purchaseOrder).where(inArray(purchaseOrder.customerId, ids));
    for (const f of files) await deleteStoredFile(f.id); // the stored bytes too, not just the row
    await db.delete(quotation).where(inArray(quotation.customerId, ids));
    await db.delete(customer).where(inArray(customer.id, ids));
  }
  await db.delete(product).where(eq(product.name, TILE));
  if (createdProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "E2E FF Alpha Tiles"));
  await db.delete(user).where(eq(user.email, owner.email));
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

// Next keeps the previous page of a navigation mounted but hidden, so only visible elements are the page in front.
const field = (page: Page, label: string) => page.locator(`[aria-label="${label}"]:visible`);
const testId = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

test("customer, quotation, approval, PO and two challans, with the dashboard and audit log following along", async ({ page, browser }) => {
  await signIn(page);

  // --- 1. customer ------------------------------------------------------------------------
  await page.goto("/customers/new");
  await page.getByLabel("Name", { exact: true }).fill(CUSTOMER);
  await page.locator("#stateCode").selectOption("27");
  await page.getByLabel("Address line 1").fill("Baner Road");
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/, SLOW);
  const customerId = page.url().split("/").pop()!;

  // --- 2. quotation for 100 boxes, issued -----------------------------------------------------
  await page.goto("/quotations/new");
  await page.getByLabel("Find customer").fill(CUSTOMER);
  await page.getByRole("button", { name: new RegExp(CUSTOMER) }).click();
  await page.getByLabel("Add product").fill(TILE);
  await page.getByRole("button", { name: new RegExp(TILE) }).click();
  await field(page, "Quantity, line 1").fill("100");
  // Valid until tomorrow: soonest first on the dashboard, so this quotation is on its first screen whatever else exists.
  await page.getByLabel("Valid until").fill(dayFromNow(1));
  // 100 x 580 = 58,000 + 18% GST (9% + 9%) = 68,440
  await expect(testId(page, "grand-total")).toContainText("68,440.00");
  await page.getByRole("button", { name: "Issue quotation" }).click();
  await expect(page).toHaveURL(/\/quotations\/[0-9a-f-]{36}$/, SLOW);
  const quotationId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/^QT\//);
  const quotationNumber = (await page.getByRole("heading", { level: 1 }).innerText()).match(/QT\/\S+/)![0];
  // A PO cannot be recorded until it is approved.
  await expect(page.locator('[aria-label="Purchase orders"]:visible').getByRole("button", { name: "Record PO" })).toBeDisabled();

  // --- 3. the dashboard lists it as open and expiring soon ---------------------------------------
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible(SLOW);
  const open = page.getByRole("region", { name: "Open quotations" });
  const soon = page.getByRole("region", { name: "Expiring soon" });
  await expect(open.locator(`a[href="/quotations/${quotationId}"]`)).toContainText(quotationNumber);
  await expect(soon.locator(`a[href="/quotations/${quotationId}"]`)).toContainText("1 day left");

  // --- 4. approve, record the PO with its file ---------------------------------------------------
  await page.goto(`/quotations/${quotationId}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator('[aria-label="Purchase orders"]:visible').getByRole("link", { name: "Record PO" })).toBeVisible(SLOW);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Open quotations" }).locator(`a[href="/quotations/${quotationId}"]`)).toHaveCount(0); // approved: no longer open

  await page.goto(`/orders/new?quotation=${quotationId}`);
  await expect(field(page, "Ordered quantity, line 1")).toHaveValue("100");
  await page.locator("#customerPoNumber:visible").fill(PO_NUMBER);
  await page.locator("#files:visible").setInputFiles({ name: "customer-po.pdf", mimeType: "application/pdf", buffer: PO_PDF });
  await page.getByRole("button", { name: "Record PO" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, SLOW);
  const orderId = page.url().split("/").pop()!;
  await expect(testId(page, "po-pending-1")).toHaveText("100 Box");

  // --- 5. the dashboard lists the PO as waiting for delivery -----------------------------------------
  await page.goto("/");
  const deliveries = page.getByRole("region", { name: "POs with pending deliveries" });
  await expect(deliveries.locator(`a[href="/orders/${orderId}"]`)).toContainText("1 of 1 line pending", SLOW);

  // --- 6. challan 1: 60 of 100 -------------------------------------------------------------------------
  await page.goto(`/challans/new?order=${orderId}`);
  await expect(field(page, "Delivered quantity, line 1")).toHaveValue("100");
  await field(page, "Delivered quantity, line 1").fill("60");
  await page.locator("#vehicleNo:visible").fill("MH12 AB 1234");
  await page.getByRole("button", { name: "Issue challan" }).click();
  await expect(page).toHaveURL(/\/challans\/[0-9a-f-]{36}$/, SLOW);
  const challan1 = page.url().split("/").pop()!;
  await page.goto(`/orders/${orderId}`);
  await expect(testId(page, "po-delivered-1")).toHaveText("60 Box");
  await expect(testId(page, "po-pending-1")).toHaveText("40 Box");
  await expect(page.getByText("Partially delivered").first()).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("region", { name: "POs with pending deliveries" }).locator(`a[href="/orders/${orderId}"]`)).toContainText("Partially delivered");

  // --- 7. challan 2: the remaining 40 -> delivered ------------------------------------------------------------
  await page.goto(`/challans/new?order=${orderId}`);
  await expect(field(page, "Delivered quantity, line 1")).toHaveValue("40");
  await page.getByRole("button", { name: "Issue challan" }).click();
  await expect(page).toHaveURL(/\/challans\/[0-9a-f-]{36}$/, SLOW);
  const challan2 = page.url().split("/").pop()!;
  expect(challan2).not.toBe(challan1);
  await page.goto(`/orders/${orderId}`);
  await expect(testId(page, "po-delivered-1")).toHaveText("100 Box");
  await expect(testId(page, "po-pending-1")).toHaveText("0 Box");
  await expect(page.getByText("Delivered", { exact: true }).first()).toBeVisible();
  await expect(testId(page, "po-challan")).toHaveCount(2);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "POs with pending deliveries" }).locator(`a[href="/orders/${orderId}"]`)).toHaveCount(0); // fully delivered: off the list

  // --- 8. numbers are sequential, and the documents download ----------------------------------------------------
  const db = getDb();
  const rows = await db.select().from(deliveryChallan).where(eq(deliveryChallan.purchaseOrderId, orderId)).orderBy(deliveryChallan.createdAt);
  expect(rows).toHaveLength(2);
  // Increasing (not "+1": other specs may issue a challan in between; gap-free numbering is tested in tests/integration/numbering.test.ts).
  expect(Number(rows[1].number.split("/")[2])).toBeGreaterThan(Number(rows[0].number.split("/")[2]));
  const quotationPdf = await page.request.get(`/api/documents/quotation/${quotationId}/pdf`);
  expect(quotationPdf.status()).toBe(200);
  expect((await quotationPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const challanPdf = await page.request.get(`/api/documents/challan/${challan2}/pdf`);
  expect(challanPdf.status()).toBe(200);
  expect((await challanPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const [attached] = await db.select({ id: poFile.fileId }).from(poFile).where(eq(poFile.purchaseOrderId, orderId));
  expect((await page.request.get(`/api/files/${attached.id}`)).status()).toBe(200);

  // ...and none of them opens without signing in (quickstart scenario 10).
  const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin });
  for (const url of [`/api/documents/quotation/${quotationId}/pdf`, `/api/documents/challan/${challan2}/pdf`, `/api/files/${attached.id}`]) {
    expect((await anonymous.request.get(url)).status(), url).toBe(401);
  }
  await anonymous.close();

  // --- 9. the owner's audit log tells the story -------------------------------------------------------------------
  await page.goto("/settings/audit?type=quotation");
  await expect(page.getByRole("heading", { name: "Audit log", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Quotation" }).first()).toBeVisible(SLOW);
  const entries = await db.select().from(auditLog).where(inArray(auditLog.entityId, [customerId, quotationId, orderId, challan1, challan2]));
  const seen = entries.map((e) => `${e.entityType}:${e.action}${e.toStatus ? `>${e.toStatus}` : ""}`).sort();
  expect(seen).toEqual(
    [
      "customer:create",
      "quotation:create>draft",
      "quotation:status_change>sent",
      "quotation:status_change>approved",
      "purchase_order:create>open",
      "purchase_order:status_change>partially_delivered",
      "purchase_order:status_change>delivered",
      "delivery_challan:create>issued",
      "delivery_challan:create>issued",
    ].sort(),
  );
  // Filtering by record type and by action narrows the view to this run's challans.
  await page.goto("/settings/audit?type=delivery_challan&action=create");
  await expect(page.getByRole("table")).toContainText("E2E FF Owner", SLOW);
});
