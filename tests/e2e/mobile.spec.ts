import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { cleanupPhoneData, hideDevIndicator, MIN_TARGET, measurePage, seedPhoneData, signInAs, SLOW, type PhoneData } from "./support/phone";

// T092: the main flows at iPhone width (390 x 844, the `iphone-390` project): sign in, open the menu, create a customer,
// create and issue a quotation, open its PDF, record a PO and issue a challan. Every screen on the way must have no
// sideways scroll, no touch target under 44 px and no field text under 16 px (see measurePage), and the key controls
// must be visible and big enough. mobile-audit.spec.ts checks every other screen at 375, 390 and 430 px.
// With PHONE_SHOTS=1 it also saves screenshots of each step under docs/phone/ (used for T093).
// Runs against the TEST database only. Everything created is prefixed "E2E PH ".
test.setTimeout(480_000);
let data: PhoneData | undefined;

test.beforeAll(async () => {
  data = await seedPhoneData();
});
test.afterAll(async () => {
  await cleanupPhoneData(data);
});
test.beforeEach(async ({ page }) => {
  await hideDevIndicator(page);
});

const shots = process.env.PHONE_SHOTS ? path.join("docs", "phone") : null;
async function shot(page: Page, name: string, fullPage = false) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage });
}

/** No sideways scroll, no small targets, no small field text on the screen currently in front. */
async function expectFits(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const findings = await measurePage(page);
  expect(findings.map((f) => `${f.kind}: ${f.detail}`)).toEqual([]);
}

async function expectTapSize(locator: ReturnType<Page["locator"]>) {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  expect(box.height, "control height").toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
  expect(box.width, "control width").toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
}

const testId = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

test("sign in, menu, customer, quotation, PDF, purchase order and challan on an iPhone", async ({ page }) => {
  const d = data!;
  expect(page.viewportSize()!.width).toBe(390);
  const customerName = `E2E PH Mobile Buyer ${d.suffix}`;

  // --- sign in --------------------------------------------------------------------------
  await page.goto("/sign-in");
  await expectFits(page);
  await shot(page, "01-sign-in");
  // The viewport asks for the whole screen (notch and home bar included) and iOS not to zoom on its own.
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  await signInAs(page, d.owner);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible(SLOW);
  await expectFits(page);
  await shot(page, "02-dashboard");

  // --- the navigation drawer ------------------------------------------------------------
  const menu = page.getByRole("button", { name: "Menu" });
  await expectTapSize(menu);
  await expect(page.locator("aside")).toBeHidden(); // the desktop sidebar is not on a phone
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await expect(drawer).toBeVisible();
  await expectFits(page);
  await shot(page, "03-menu");
  for (const name of ["Quotations", "Purchase orders", "Challans", "Customers", "Products", "Users"]) {
    await expectTapSize(drawer.getByRole("link", { name, exact: true }));
  }
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await drawer.getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/, SLOW);
  await expect(drawer).toBeHidden();
  await expectFits(page);

  // --- create a customer ----------------------------------------------------------------
  await page.getByRole("link", { name: "New customer" }).click();
  await expect(page).toHaveURL(/\/customers\/new$/, SLOW);
  await page.getByLabel("Name", { exact: true }).fill(customerName);
  await page.locator("#stateCode").selectOption("27");
  await page.getByLabel("Address line 1").fill("Baner Road");
  await page.getByLabel("City").fill("Pune");
  await expectFits(page);
  await shot(page, "04-new-customer");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/, SLOW);
  await expectFits(page);

  // --- create and issue a quotation -----------------------------------------------------
  await page.goto("/quotations/new");
  await page.getByLabel("Find customer").fill(customerName);
  await page.getByRole("button", { name: new RegExp(customerName) }).click();
  await page.getByLabel("Add product").fill(d.tileName);
  await page.getByRole("button", { name: new RegExp(d.tileName) }).click();
  await page.locator('[aria-label="Quantity, line 1"]:visible').fill("6");
  await expect(testId(page, "grand-total")).toContainText("₹");
  await expectFits(page);
  // The Save / Issue bar stays on screen even though the form is long, and above the home bar.
  const issue = page.getByRole("button", { name: "Issue quotation" });
  await expect(issue).toBeInViewport({ ratio: 1 });
  await expectTapSize(issue);
  await shot(page, "05-quotation-editor");
  await shot(page, "05b-quotation-editor-full", true);
  await issue.click();
  await expect(page).toHaveURL(/\/quotations\/[0-9a-f-]{36}$/, SLOW);
  const quotationId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/^QT\//);
  await expectFits(page);
  await shot(page, "06-quotation-detail");
  await shot(page, "06b-quotation-detail-full", true);

  // --- the PDF: View opens it in its own tab, Download saves it, and the app stays where it is ----
  const pdfRegion = page.locator('[aria-label="PDF"]:visible');
  const view = pdfRegion.getByRole("link", { name: /^View PDF/ });
  const download = pdfRegion.getByRole("link", { name: "Download PDF" });
  await expectTapSize(view);
  await expectTapSize(download);
  await expect(view).toHaveAttribute("target", "_blank");
  await expect(download).toHaveAttribute("download", "");
  await expect(testId(page, "pdf-phone-hint")).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await view.click();
  const popup = await popupPromise;
  const viewed = await page.request.get((await view.getAttribute("href"))!);
  expect(viewed.status()).toBe(200);
  expect(viewed.headers()["content-type"]).toBe("application/pdf");
  expect(viewed.headers()["content-disposition"]).toMatch(/^inline/);
  await popup.close();
  const saved = await page.request.get((await download.getAttribute("href"))!);
  expect(saved.headers()["content-disposition"]).toMatch(/^attachment/);
  expect((await saved.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  await expect(page).toHaveURL(new RegExp(`/quotations/${quotationId}$`)); // never left the app
  await shot(page, "07-quotation-pdf-actions");

  // --- purchase order, against the approved quotation made for this run -----------------------
  await page.goto(`/quotations/${d.ids.quotation}`);
  await page.locator('[aria-label="Purchase orders"]:visible').getByRole("link", { name: "Record PO" }).click();
  await expect(page).toHaveURL(/\/orders\/new\?quotation=/, SLOW);
  await page.locator("#customerPoNumber").fill(`PO/PH/UI/${d.suffix}`);
  await expect(page.locator('[aria-label="Ordered quantity, line 1"]:visible')).toBeVisible();
  await expectFits(page);
  await shot(page, "08-record-po");
  await shot(page, "08b-record-po-full", true);
  await expectTapSize(page.getByRole("button", { name: "Record PO" }));
  await page.getByRole("button", { name: "Record PO" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, SLOW);
  await expectFits(page);
  await shot(page, "09-po-detail");
  await shot(page, "09b-po-detail-full", true);

  // --- challan against that PO ------------------------------------------------------------------
  await page.locator('[aria-label="Challans"]:visible').getByRole("link", { name: "New challan" }).click();
  await expect(page).toHaveURL(/\/challans\/new\?order=/, SLOW);
  await expect(page.locator('[aria-label="Delivered quantity, line 1"]:visible')).toBeVisible();
  await page.locator("#vehicleNo").fill("MH12 AB 1234");
  await expectFits(page);
  await shot(page, "10-new-challan");
  await shot(page, "10b-new-challan-full", true);
  const issueChallan = page.getByRole("button", { name: "Issue challan" });
  await expectTapSize(issueChallan);
  await issueChallan.click();
  await expect(page).toHaveURL(/\/challans\/[0-9a-f-]{36}$/, SLOW);
  await expectFits(page);
  const challanPdf = page.locator('[aria-label="PDF"]:visible');
  await expectTapSize(challanPdf.getByRole("link", { name: "View PDF without prices" }));
  await expectTapSize(challanPdf.getByRole("link", { name: "Download PDF" }));
  await shot(page, "11-challan-detail");

  // --- lists are cards on a phone, not a wide table ------------------------------------------------
  await page.goto("/quotations");
  await expect(page.locator("table.stack thead").first()).toHaveCSS("position", "absolute");
  await expect(page.locator("table.stack tbody tr").first()).toHaveCSS("display", "block");
  await expectFits(page);
  await shot(page, "12-quotation-list");
  await page.goto("/orders");
  await expectFits(page);
  await shot(page, "13-order-list");
});
