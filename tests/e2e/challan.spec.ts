import { randomBytes } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "@/db";
import { auditLog, businessProfile, customer, deliveryChallan, product, purchaseOrder, quotation, quotationLine, user } from "@/db/schema";
import { createStaffUser } from "@/lib/auth/create-user";
import { approveQuotation, issueQuotation, saveDraft, type DraftInput } from "@/server/quotation-core";
import { recordPurchaseOrder } from "@/server/order-core";

// Quickstart scenarios 8 and 9 (US4): two partial challans from a PO, pending after each, the over-delivery block for
// sales, cancelling the first (number kept, pending restored), and the PDF with prices hidden and shown. Runs against the
// TEST database only. Everything created here is prefixed "E2E CH " and removed afterwards.
const suffix = randomBytes(4).toString("hex");
const sales = { name: "E2E CH Sales", email: `e2e-ch-sales-${suffix}@example.test`, password: `Sales-${randomBytes(9).toString("base64url")}`, role: "sales" as const };
const CUSTOMER = `E2E CH Radius ${suffix}`;
const TILE = `E2E CH ATN 600X600 Plain Ivory ${suffix}`;
const SINK = `E2E CH Sink 24 inch ${suffix}`;
let actorId: string;
let customerId: string;
let tileId: string;
let sinkId: string;
let createdProfile = false;

test.setTimeout(240_000);
const SLOW = { timeout: 60_000 };

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
    .values({ legalName: "E2E CH Alpha Tiles", tradeName: "Alpha Tiles", addressLine1: "Shop No. G-4, The Capital Mall", city: "Pune", state: "Maharashtra", stateCode: "27", gstin: "27ABYFA7430K1ZT" })
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
  const challans = await db.select({ id: deliveryChallan.id }).from(deliveryChallan).where(eq(deliveryChallan.customerId, customerId));
  const entityIds = [...quotes.map((q) => q.id), ...orders.map((o) => o.id), ...challans.map((c) => c.id)];
  if (entityIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, entityIds));
  await db.delete(deliveryChallan).where(eq(deliveryChallan.customerId, customerId));
  await db.delete(purchaseOrder).where(eq(purchaseOrder.customerId, customerId));
  await db.delete(quotation).where(eq(quotation.customerId, customerId));
  await db.delete(customer).where(eq(customer.id, customerId));
  await db.delete(product).where(like(product.name, "E2E CH %"));
  if (createdProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "E2E CH Alpha Tiles"));
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
const qty = (page: Page, line: number) => page.locator(`[aria-label="Delivered quantity, line ${line}"]:visible`);
const testId = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

/** A PO for 4 boxes of tile and 10 sinks, made through the domain code (the quotation and PO UIs have their own specs). */
async function purchaseOrderOf4And10() {
  const db = getDb();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const input: DraftInput = {
    customerId,
    quotationDate: today,
    validUntil: new Date(Date.now() + 10 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    billTo: { name: CUSTOMER, gstin: null, address: "Baner, Pune", stateCode: "27" },
    shipTo: { name: `${CUSTOMER} site`, address: "Wakad, Pune", stateCode: "27", contactName: null, contactPhone: null },
    layout: "gst_quotation",
    terms: null,
    advanceAmount: "0",
    notes: null,
    lines: [
      { kind: "product", productId: tileId, description: TILE, hsnCode: "6907", unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", quantity: "4", rate: "580.00", discountPercent: "0", gstRate: "18" },
      { kind: "product", productId: sinkId, description: SINK, hsnCode: "6910", unit: "piece", piecesPerBox: null, sqftPerBox: null, quantity: "10", rate: "1200.00", discountPercent: "10", gstRate: "18" },
    ],
  };
  const { id: quotationId } = await saveDraft(db, actorId, input);
  await issueQuotation(db, actorId, quotationId);
  await approveQuotation(db, actorId, quotationId);
  const [q] = await db.select({ rev: quotation.currentRevisionId }).from(quotation).where(eq(quotation.id, quotationId));
  const quoted = await db.select().from(quotationLine).where(eq(quotationLine.revisionId, q.rev!)).orderBy(quotationLine.lineNo);
  const poNumber = `PO/CH/${suffix}/${randomBytes(2).toString("hex")}`;
  const { id } = await recordPurchaseOrder(db, actorId, {
    quotationId,
    customerPoNumber: poNumber,
    poDate: today,
    advanceReceived: "0",
    notes: null,
    lines: quoted.map((l) => ({ quotationLineId: l.id, quantity: l.quantity })),
  });
  return { id, poNumber };
}

test("two partial challans, the over-delivery block, cancelling the first, and the PDF with prices hidden and shown", async ({ page }) => {
  const po = await purchaseOrderOf4And10();
  const db = getDb();
  await signIn(page);

  // --- Challan 1: 3 of 4 boxes, no sinks, prices hidden --------------------------------
  await page.goto(`/orders/${po.id}`);
  await expect(testId(page, "po-pending-1")).toHaveText("4 Box");
  await page.locator('[aria-label="Challans"]:visible').getByRole("link", { name: "New challan" }).click();
  await expect(page).toHaveURL(new RegExp(`/challans/new\\?order=${po.id}`), SLOW);
  await expect(page.getByRole("heading", { name: "New delivery challan" })).toBeVisible();
  // Quantities start at what is pending.
  await expect(qty(page, 1)).toHaveValue("4");
  await expect(qty(page, 2)).toHaveValue("10");
  await expect(page.locator("#consigneeName:visible")).toHaveValue(`${CUSTOMER} site`);
  await expect(page.locator("#consigneeAddress:visible")).toHaveValue("Wakad, Pune");

  await qty(page, 1).fill("3");
  await expect(testId(page, "pending-note-1")).toHaveText("1 will remain pending");
  await qty(page, 2).fill("");
  await expect(testId(page, "pending-note-2")).toHaveText("not on this challan");
  await page.locator("#vehicleNo:visible").fill("MH12 AB 1234");
  await page.locator("#driverName:visible").fill("Ramesh");
  await page.locator("#driverPhone:visible").fill("9800000000");
  await page.locator("#destination:visible").fill("Wakad");
  await page.getByRole("button", { name: "Issue challan" }).click();
  await expect(page).toHaveURL(/\/challans\/[0-9a-f-]{36}$/, SLOW);
  const first = page.url().split("/").pop()!;
  const [row1] = await db.select().from(deliveryChallan).where(eq(deliveryChallan.id, first));
  await expect(page.getByRole("heading", { name: `Challan ${row1.number}` })).toBeVisible();
  await expect(testId(page, "challan-line-1")).toContainText("3 Box");
  await expect(page.locator('[aria-label="Dispatch details"]:visible')).toContainText("MH12 AB 1234");
  expect(row1).toMatchObject({ status: "issued", showPrices: false, vehicleNo: "MH12 AB 1234", driverName: "Ramesh" });

  await page.goto(`/orders/${po.id}`);
  await expect(testId(page, "po-delivered-1")).toHaveText("3 Box");
  await expect(testId(page, "po-pending-1")).toHaveText("1 Box");
  await expect(testId(page, "po-pending-2")).toHaveText("10 Nos");
  await expect(page.getByText("Partially delivered").first()).toBeVisible();
  await expect(testId(page, "po-challan")).toHaveCount(1);

  // --- Challan 2: the rest, prices shown -----------------------------------------------
  await page.goto(`/challans/new?order=${po.id}`);
  await expect(qty(page, 1)).toHaveValue("1");
  await expect(qty(page, 2)).toHaveValue("10");
  await page.getByLabel(/Show prices on the challan/).check();
  await page.getByRole("button", { name: "Issue challan" }).click();
  await expect(page).toHaveURL(/\/challans\/[0-9a-f-]{36}$/, SLOW);
  const second = page.url().split("/").pop()!;
  const [row2] = await db.select().from(deliveryChallan).where(eq(deliveryChallan.id, second));
  expect(row2.showPrices).toBe(true);
  expect(Number(row2.number.split("/")[2])).toBe(Number(row1.number.split("/")[2]) + 1);

  await page.goto(`/orders/${po.id}`);
  await expect(testId(page, "po-pending-1")).toHaveText("0 Box");
  await expect(testId(page, "po-pending-2")).toHaveText("0 Nos");
  await expect(page.getByText("Delivered", { exact: true }).first()).toBeVisible();
  await expect(testId(page, "po-challan")).toHaveCount(2);

  // --- One more is blocked for sales ----------------------------------------------------
  await page.goto(`/challans/new?order=${po.id}`);
  await expect(testId(page, "nothing-pending")).toContainText("Only the owner can deliver more");
  await qty(page, 1).fill("1");
  await expect(testId(page, "pending-note-1")).toContainText("1 more than pending");
  await expect(page.locator('[aria-label="Override"]:visible')).toHaveCount(0); // no override control for sales
  await page.getByRole("button", { name: "Issue challan" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Only the owner can deliver more than what is pending" }).first()).toBeVisible(SLOW);
  expect(await db.select({ id: deliveryChallan.id }).from(deliveryChallan).where(eq(deliveryChallan.purchaseOrderId, po.id))).toHaveLength(2);

  // --- The PDF, prices hidden and shown (quickstart scenario 9) -------------------------
  const pdf = (id: string, query: string) => page.request.get(`/api/documents/challan/${id}/pdf${query}`);
  const hidden = await pdf(second, "?prices=hide");
  const shown = await pdf(second, "?prices=show");
  for (const response of [hidden, shown]) {
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  }
  expect((await pdf(second, "?download=1")).headers()["content-disposition"]).toContain(`attachment; filename="${row2.number.replaceAll("/", "-")}.pdf"`);
  // The challan was issued with prices on, so that is the default; the option overrides it either way.
  expect((await (await pdf(second, "")).body()).length).toBe((await shown.body()).length);
  expect((await shown.body()).length).toBeGreaterThan((await hidden.body()).length);
  expect((await pdf(second, "?prices=maybe")).status()).toBe(400);
  expect((await pdf(crypto.randomUUID(), "")).status()).toBe(404);
  const anonymous = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
  expect((await anonymous.request.get(`/api/documents/challan/${second}/pdf`)).status()).toBe(401);
  await anonymous.close();

  // --- Cancel the first challan ---------------------------------------------------------
  await page.goto(`/challans/${first}`);
  await expect(page.getByRole("button", { name: "Cancel challan" })).toBeVisible();
  await page.getByLabel(/Reason for cancelling/).fill("Goods were not dispatched");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Cancel challan" }).click();
  await expect(testId(page, "challan-cancelled")).toContainText("Goods were not dispatched", SLOW);
  await expect(testId(page, "challan-cancelled")).toContainText(`${row1.number} stays reserved`);
  const cancelledPdf = await pdf(first, "?prices=hide");
  expect(cancelledPdf.status()).toBe(200);

  await page.goto(`/orders/${po.id}`);
  await expect(testId(page, "po-delivered-1")).toHaveText("1 Box");
  await expect(testId(page, "po-pending-1")).toHaveText("3 Box"); // restored
  await expect(page.locator('[aria-label="Challans"]:visible').getByText(row1.number)).toBeVisible(); // number retained
  await expect(page.locator('[aria-label="Challans"]:visible').getByText("Cancelled")).toBeVisible();

  // The list finds it by number and by status.
  await page.goto(`/challans?number=${encodeURIComponent(row1.number)}&status=cancelled`);
  await expect(page.getByRole("link", { name: row1.number })).toBeVisible();
  await page.goto(`/challans?po=${encodeURIComponent(po.poNumber)}`);
  await expect(page.getByRole("link", { name: row2.number })).toBeVisible();

  const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, first));
  expect(audit.map((a) => a.action)).toEqual(["create", "status_change"]);
});
