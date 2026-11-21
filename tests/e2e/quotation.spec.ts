import { randomBytes } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, inArray, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "@/db";
import { auditLog, businessProfile, chargeType, customer, product, quotation, quotationRevision, user } from "@/db/schema";
import { createStaffUser } from "@/lib/auth/create-user";

// Runs against the TEST database only (playwright.config.ts points DATABASE_URL at it, and beforeAll refuses otherwise).
// Everything created here is prefixed "E2E Q" and removed afterwards.
const suffix = randomBytes(4).toString("hex");
const sales = { name: "E2E Q Sales", email: `e2e-q-sales-${suffix}@example.test`, password: `Sales-${randomBytes(9).toString("base64url")}`, role: "sales" as const };
const CUSTOMER = `E2E Q Radius ${suffix}`;
const JAIPUR = `E2E Q Jaipur Traders ${suffix}`;
const TILE = `E2E Q ATN 600X600 Plain Ivory ${suffix}`;
const GRANITE = `E2E Q Granite Cherry Brown ${suffix}`;
const TRANSPORT = `E2E Q Transport Charges ${suffix}`;
let createdProfile = false;

// The TEST database is a remote Neon branch: saving and issuing run several transactions, so allow time.
test.setTimeout(240_000);
const SLOW = { timeout: 60_000 };

test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("e2e tests must run against TEST_DATABASE_URL only");
  }
  const db = getDb();
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
  await createStaffUser(sales);
  // Spec files run in parallel and share the one business_profile row: insert only if nobody else just did.
  const inserted = await db
    .insert(businessProfile)
    .values({
      legalName: "E2E Q Alpha Tiles", tradeName: "Alpha Tiles", addressLine1: "Shop No. G-4, The Capital Mall", city: "Pune", state: "Maharashtra", stateCode: "27", gstin: "27ABYFA7430K1ZT",
    })
    .onConflictDoNothing()
    .returning({ id: businessProfile.id });
  createdProfile = inserted.length > 0;
  await db.insert(customer).values([
    { type: "company", displayName: CUSTOMER, stateCode: "27", addressLine1: "Baner", city: "Pune" },
    { type: "company", displayName: JAIPUR, gstin: "08BOSPP7444G1ZA", stateCode: "08", addressLine1: "Malviya Nagar", city: "Jaipur" },
  ]);
  await db.insert(product).values([
    { name: TILE, sizeLabel: "600 x 600", unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", hsnCode: "6907", gstRate: "18", sellingPricePerUnit: "580.00" },
    { name: GRANITE, unit: "sqft", hsnCode: "6802", gstRate: "18", sellingPricePerUnit: "100.00" },
  ]);
  await db.insert(chargeType).values({ name: TRANSPORT, hsnSacCode: "8704", gstRate: "18" });
});

test.afterAll(async () => {
  const db = getDb();
  const customers = await db.select({ id: customer.id }).from(customer).where(like(customer.displayName, "E2E Q %"));
  if (customers.length) {
    const ids = customers.map((c) => c.id);
    const quotes = await db.select({ id: quotation.id }).from(quotation).where(inArray(quotation.customerId, ids));
    if (quotes.length) {
      await db.delete(auditLog).where(inArray(auditLog.entityId, quotes.map((q) => q.id)));
      await db.delete(quotation).where(inArray(quotation.customerId, ids));
    }
    await db.delete(customer).where(inArray(customer.id, ids));
  }
  await db.delete(product).where(like(product.name, "E2E Q %"));
  await db.delete(chargeType).where(like(chargeType.name, "E2E Q %"));
  if (createdProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "E2E Q Alpha Tiles"));
  await db.delete(user).where(eq(user.email, sales.email));
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(sales.email);
  await page.getByLabel("Password").fill(sales.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

// Next keeps the previous page of a navigation mounted but hidden, so the same labels can exist twice in the DOM
// (for example the "new quotation" editor behind the "revise" editor); only the visible one is the page in front.
const field = (page: Page, label: string) => page.locator(`[aria-label="${label}"]:visible`);

async function addProduct(page: Page, name: string) {
  await page.getByLabel("Add product").fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
}

test("create a quotation with two products and transport, issue it, download the PDF; revise it; expiry shows", async ({ page, request }) => {
  await signIn(page);

  // --- create ---------------------------------------------------------------
  await page.goto("/quotations/new");
  await page.getByLabel("Find customer").fill("E2E Q Radius");
  await page.getByRole("button", { name: new RegExp(CUSTOMER) }).click();
  await expect(page.getByLabel("Bill to").or(page.getByText(CUSTOMER).first())).toBeVisible();

  await addProduct(page, TILE);
  await addProduct(page, GRANITE);
  await page.getByRole("button", { name: `+ ${TRANSPORT}` }).click();

  // Line 1: 4 boxes at 580 (prefilled from the selling price). Typing sq.ft shows the boxes it rounds up to.
  await expect(field(page, "Rate, line 1")).toHaveValue("580");
  await field(page, "Quantity measure, line 1").selectOption("sqft");
  await field(page, "Quantity, line 1").fill("60");
  await expect(page.locator('[data-testid="equivalent-1"]:visible')).toHaveText("4 box = 62 sq.ft");
  // Line 2: granite by the sq.ft, no packing.
  await field(page, "Quantity, line 2").fill("10");
  await expect(field(page, "Rate, line 2")).toHaveValue("100");
  // Line 3: the transport charge.
  await field(page, "Rate, line 3").fill("550");

  // 2,320 + 1,000 + 550 = 3,870 taxable; 9% + 9% = 696.60; 4,566.60 rounds to 4,567.00
  await expect(page.locator('[data-testid="grand-total"]:visible')).toHaveText("₹ 4,567.00");
  await expect(page.locator('[data-testid="total-in-words"]:visible')).toHaveText("INR Four Thousand Five Hundred Sixty Seven Only");
  await expect(page.getByRole("region", { name: "Totals" })).toContainText("CGST");
  await expect(page.getByRole("region", { name: "Totals" })).not.toContainText("IGST");

  // --- issue ----------------------------------------------------------------
  await page.getByRole("button", { name: "Issue quotation" }).click();
  await expect(page).toHaveURL(/\/quotations\/[0-9a-f-]{36}$/, SLOW);
  const id = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/^QT\/\d{4}-\d{2}\/\d{4}/);
  const number = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await expect(page.getByText("₹ 4,567.00").first()).toBeVisible();

  // --- PDF ------------------------------------------------------------------
  const pdf = await page.request.get(`/api/documents/quotation/${id}/pdf?download=1`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["content-disposition"]).toMatch(/^attachment; filename="QT-.*-rev1\.pdf"$/);
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(2000);

  const estimate = await page.request.get(`/api/documents/quotation/${id}/pdf?layout=estimate`);
  expect(estimate.status()).toBe(200);
  expect(estimate.headers()["content-type"]).toBe("application/pdf");
  expect(estimate.headers()["content-disposition"]).toMatch(/^inline/);

  // The cached copy of the issued revision is served the second time.
  const again = await page.request.get(`/api/documents/quotation/${id}/pdf?download=1`);
  expect(again.status()).toBe(200);
  expect((await again.body()).equals(bytes)).toBe(true);

  // Signed-out requests get 401 (a fresh request context has no session cookie).
  const anonymous = await request.get(`/api/documents/quotation/${id}/pdf`);
  expect(anonymous.status()).toBe(401);

  // --- revise: the number stays, revision 1 stays viewable ------------------
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/quotations/${id}/revise$`), SLOW);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`Revise ${number}`);
  await field(page, "Quantity measure, line 1").selectOption("box");
  await field(page, "Quantity, line 1").fill("6");
  await page.getByRole("button", { name: "Issue revision" }).click();
  await expect(page).toHaveURL(new RegExp(`/quotations/${id}$`), SLOW);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(number);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("revision 2");
  await page.getByRole("link", { name: "Revision 1" }).click();
  await expect(page.getByText("You are looking at revision 1")).toBeVisible();
  await expect(page.getByText("₹ 4,567.00").first()).toBeVisible();

  // --- a past valid-until shows as expired ----------------------------------
  const db = getDb();
  await db.update(quotationRevision).set({ quotationDate: "2020-01-01", validUntil: "2020-01-15" }).where(eq(quotationRevision.quotationId, id));
  await page.goto(`/quotations/${id}`);
  await expect(page.getByText("Expired", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reinstate" })).toBeVisible();

  // The list shows it with its derived status and can filter on it.
  await page.goto(`/quotations?status=expired&number=${encodeURIComponent(number)}`);
  await expect(page.getByRole("link", { name: number })).toBeVisible();
});

test("an unissued draft cannot be downloaded without ?preview=1 and has no number", async ({ page }) => {
  await signIn(page);
  await page.goto("/quotations/new");
  await page.getByLabel("Find customer").fill("E2E Q Radius");
  await page.getByRole("button", { name: new RegExp(CUSTOMER) }).click();
  await addProduct(page, TILE);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved", SLOW);

  const db = getDb();
  const [owner] = await db.select({ id: customer.id }).from(customer).where(eq(customer.displayName, CUSTOMER));
  const drafts = await db.select().from(quotation).where(and(eq(quotation.customerId, owner.id), eq(quotation.status, "draft")));
  expect(drafts).toHaveLength(1);
  const q = drafts[0];
  expect(q.number).toBeNull();
  const refused = await page.request.get(`/api/documents/quotation/${q.id}/pdf`);
  expect(refused.status()).toBe(409);
  const preview = await page.request.get(`/api/documents/quotation/${q.id}/pdf?preview=1`);
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toBe("application/pdf");

  await page.goto(`/quotations/${q.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Draft quotation");
});

test("an inter-state customer gets IGST, and the Radius 9 numbers come out exactly (4 box x 580 + 550 transport = 3,387.00)", async ({ page }) => {
  await signIn(page);
  await page.goto("/quotations/new");
  await page.getByLabel("Find customer").fill("E2E Q Jaipur");
  await page.getByRole("button", { name: new RegExp(JAIPUR) }).click();
  await addProduct(page, TILE);
  await page.getByRole("button", { name: `+ ${TRANSPORT}` }).click();
  await field(page, "Quantity, line 1").fill("4");
  await field(page, "Rate, line 2").fill("550");

  const totals = page.getByRole("region", { name: "Totals" });
  await expect(page.locator('[data-testid="grand-total"]:visible')).toHaveText("₹ 3,387.00");
  await expect(totals).toContainText("IGST");
  await expect(totals).toContainText("₹ 516.60");
  await expect(totals).toContainText("+0.40");
  await expect(totals).not.toContainText("CGST");
  await expect(page.locator('[data-testid="total-in-words"]:visible')).toHaveText("INR Three Thousand Three Hundred Eighty Seven Only");

  // Switching the delivery to a Maharashtra address turns it into CGST + SGST of 258.30 each.
  await page.getByLabel("Delivery address").selectOption("other");
  await page.getByRole("combobox", { name: "State" }).nth(1).selectOption("27");
  await expect(totals).toContainText("CGST");
  await expect(totals).toContainText("SGST");
  await expect(totals).toContainText("₹ 258.30");
  await expect(totals).not.toContainText("IGST");
  await expect(page.locator('[data-testid="grand-total"]:visible')).toHaveText("₹ 3,387.00");
});
