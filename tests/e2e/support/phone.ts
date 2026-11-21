import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "@/db";
import { auditLog, brand, businessProfile, customer, deliveryChallan, file, importJob, poLine, priceList, product, purchaseOrder, quotation, quotationLine, user } from "@/db/schema";
import { createStaffUser } from "@/lib/auth/create-user";
import { deleteStoredFile } from "@/lib/storage/files";
import { createChallan } from "@/server/challan-core";
import { recordPurchaseOrder } from "@/server/order-core";
import { approveQuotation, issueQuotation, saveDraft, type DraftInput } from "@/server/quotation-core";

// Shared by the phone-width specs (mobile-audit.spec.ts, mobile.spec.ts): seed data that touches every screen, a sign-in
// helper, and the in-page measurement of horizontal overflow, small touch targets and small input text. Everything created
// is prefixed "E2E PH " (uploads "E2E-PH-") and removed by `cleanupPhoneData`. TEST database only.

export const MIN_TARGET = 44;
export const MIN_INPUT_FONT = 16;
export const WIDTHS = [375, 390, 430] as const;

export interface PhoneData {
  suffix: string;
  owner: { name: string; email: string; password: string; role: "owner" };
  ids: { customer: string; product: string; draft: string; quotation: string; order: string; challan: string; importJob?: string; priceList?: string; catalogProduct?: string };
  tileName: string;
  createdProfile: boolean;
  /** The shared business profile's HSN/GST defaults before this run changed them (restored by cleanup). */
  profileBackup: { id: string; hsn: string | null; gst: string | null } | null;
}

const slow = { timeout: 60_000 };
export const SLOW = slow;

export async function seedPhoneData(): Promise<PhoneData> {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("e2e tests must run against TEST_DATABASE_URL only");
  }
  const suffix = randomBytes(4).toString("hex");
  const db = getDb();
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
  const owner = { name: "E2E PH Owner", email: `e2e-ph-owner-${suffix}@example.test`, password: `Owner-${randomBytes(9).toString("base64url")}`, role: "owner" as const };
  const actor = await createStaffUser(owner);
  const inserted = await db
    .insert(businessProfile)
    .values({ legalName: "E2E PH Alpha Tiles", tradeName: "Alpha Tiles", addressLine1: "Shop No. G-4, The Capital Mall", city: "Pune", state: "Maharashtra", stateCode: "27", gstin: "27ABYFA7430K1ZT", defaultHsnCode: "6907", defaultGstRate: "18" })
    .onConflictDoNothing()
    .returning({ id: businessProfile.id });
  const createdProfile = inserted.length > 0;
  // The price-list import needs the default HSN code and GST rate on the shared business profile row.
  let profileBackup: PhoneData["profileBackup"] = null;
  const [profile] = await db.select().from(businessProfile).limit(1);
  if (profile && !(profile.defaultHsnCode === "6907" && profile.defaultGstRate !== null && Number(profile.defaultGstRate) === 18)) {
    profileBackup = { id: profile.id, hsn: profile.defaultHsnCode, gst: profile.defaultGstRate };
    await db.update(businessProfile).set({ defaultHsnCode: "6907", defaultGstRate: "18" }).where(eq(businessProfile.id, profile.id));
  }
  const customerName = `E2E PH Radius ${suffix}`;
  const tileName = `E2E PH ATN 600X600 Plain Ivory ${suffix}`;
  const [c] = await db.insert(customer).values({ type: "company", displayName: customerName, stateCode: "27", addressLine1: "Baner, Pune", city: "Pune", phone: "9800000000" }).returning({ id: customer.id });
  const [t] = await db
    .insert(product)
    .values({ name: tileName, sizeLabel: "600 x 600", unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", hsnCode: "6907", gstRate: "18", sellingPricePerUnit: "580.00" })
    .returning({ id: product.id });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const input: DraftInput = {
    customerId: c.id,
    quotationDate: today,
    validUntil: new Date(Date.now() + 10 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    billTo: { name: customerName, gstin: null, address: "Baner, Pune", stateCode: "27" },
    shipTo: { name: `${customerName} site`, address: "Wakad, Pune", stateCode: "27", contactName: null, contactPhone: null },
    layout: "gst_quotation",
    terms: null,
    advanceAmount: "0",
    notes: null,
    lines: [{ kind: "product", productId: t.id, description: tileName, hsnCode: "6907", unit: "box", piecesPerBox: 4, sqftPerBox: "15.50", quantity: "8", rate: "580.00", discountPercent: "0", gstRate: "18" }],
  };
  const draft = await saveDraft(db, actor.id, input);
  const { id: quotationId } = await saveDraft(db, actor.id, input);
  await issueQuotation(db, actor.id, quotationId);
  await approveQuotation(db, actor.id, quotationId);
  const [q] = await db.select({ rev: quotation.currentRevisionId }).from(quotation).where(eq(quotation.id, quotationId));
  const quoted = await db.select().from(quotationLine).where(eq(quotationLine.revisionId, q.rev!)).orderBy(quotationLine.lineNo);
  const { id: orderId } = await recordPurchaseOrder(db, actor.id, {
    quotationId,
    customerPoNumber: `PO/PH/${suffix}`,
    poDate: today,
    advanceReceived: "0",
    notes: null,
    lines: quoted.map((l) => ({ quotationLineId: l.id, quantity: l.quantity })),
  });
  const [pl] = await db.select({ id: poLine.id }).from(poLine).where(eq(poLine.purchaseOrderId, orderId));
  const { id: challanId } = await createChallan(db, actor.id, { purchaseOrderId: orderId, challanDate: today, lines: [{ poLineId: pl.id, quantity: "3" }], vehicleNo: "MH12 AB 1234", driverName: "Ramesh", showPrices: false });
  return {
    suffix,
    owner,
    tileName,
    createdProfile,
    profileBackup,
    ids: { customer: c.id, product: t.id, draft: draft.id, quotation: quotationId, order: orderId, challan: challanId },
  };
}

export async function cleanupPhoneData(data: PhoneData | undefined) {
  if (!data) return;
  const db = getDb();
  // The seeded customer and any customer a spec creates through the UI (named "E2E PH ... <suffix>").
  const customers = await db.select({ id: customer.id }).from(customer).where(like(customer.displayName, `E2E PH % ${data.suffix}`));
  const customerIds = customers.map((c) => c.id);
  const quotes = await db.select({ id: quotation.id }).from(quotation).where(inArray(quotation.customerId, customerIds));
  const orders = await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(inArray(purchaseOrder.customerId, customerIds));
  const challans = await db.select({ id: deliveryChallan.id }).from(deliveryChallan).where(inArray(deliveryChallan.customerId, customerIds));
  const brands = await db.select({ id: brand.id }).from(brand).where(like(brand.name, `E2E PH ${data.suffix} %`));
  const brandIds = brands.map((b) => b.id);
  const products = brandIds.length ? await db.select({ id: product.id }).from(product).where(inArray(product.brandId, brandIds)) : [];
  const lists = brandIds.length ? await db.select({ id: priceList.id }).from(priceList).where(inArray(priceList.brandId, brandIds)) : [];
  const jobs = await db.select({ id: importJob.id }).from(importJob).where(like(importJob.sourceName, `E2E-PH-${data.suffix}-%`));
  const entityIds = [...quotes, ...orders, ...challans, ...products, ...lists, ...brands, ...jobs].map((r) => r.id);
  if (entityIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, entityIds));
  await db.delete(deliveryChallan).where(inArray(deliveryChallan.customerId, customerIds));
  await db.delete(purchaseOrder).where(inArray(purchaseOrder.customerId, customerIds));
  await db.delete(quotation).where(inArray(quotation.customerId, customerIds));
  await db.delete(customer).where(inArray(customer.id, customerIds));
  await db.delete(product).where(eq(product.id, data.ids.product));
  if (brandIds.length) {
    await db.delete(product).where(inArray(product.brandId, brandIds));
    await db.delete(priceList).where(inArray(priceList.brandId, brandIds));
    await db.delete(brand).where(inArray(brand.id, brandIds));
  }
  if (jobs.length) await db.delete(importJob).where(inArray(importJob.id, jobs.map((j) => j.id)));
  for (const f of await db.select({ id: file.id }).from(file).where(like(file.originalName, `E2E-PH-${data.suffix}-%`))) await deleteStoredFile(f.id);
  if (data.createdProfile) await db.delete(businessProfile).where(eq(businessProfile.legalName, "E2E PH Alpha Tiles"));
  if (data.profileBackup) await db.update(businessProfile).set({ defaultHsnCode: data.profileBackup.hsn, defaultGstRate: data.profileBackup.gst }).where(eq(businessProfile.id, data.profileBackup.id));
  await db.delete(user).where(eq(user.email, data.owner.email));
}

export async function signInAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/, slow);
}

/** Uploads a price-list CSV (brands renamed "E2E PH ...") through the import screen and lands on its review page. */
export async function uploadPriceList(page: Page, suffix: string): Promise<string> {
  // Phone specs run side by side and share the one business profile row; another spec's cleanup may have restored it.
  await getDb().update(businessProfile).set({ defaultHsnCode: "6907", defaultGstRate: "18" });
  const text = readFileSync(path.join(process.cwd(), "tests/fixtures/price-lists/fun-enterprises-2026-08-01.csv"), "utf8").replace(/^(Bi'mor|colortile|Icon),/gm, `E2E PH ${suffix} $1,`);
  await page.goto("/catalog/import/new");
  await page.locator("#file").setInputFiles({ name: `E2E-PH-${suffix}-fun-2026-08-01.csv`, mimeType: "text/csv", buffer: Buffer.from(text) });
  await page.getByRole("button", { name: "Read and review" }).click();
  await expect(page).toHaveURL(/\/catalog\/import\/[0-9a-f-]{36}$/, slow);
  return page.url().split("/").pop()!;
}

export interface Finding {
  kind: "overflow" | "target" | "input-font";
  detail: string;
}

/**
 * Runs in the page. Measures what the phone checkpoint asks for, on elements that are actually visible
 * (Next keeps the previous page of a navigation mounted but hidden):
 *  - overflow: the page scrolls sideways, or something sticks out of the viewport outside a scroll container;
 *  - target: a link, button, select or field smaller than 44 x 44 px (inline links inside a sentence and
 *    check boxes whose label is large enough are not counted);
 *  - input-font: a text field, select or textarea under 16 px (iOS zooms the page on focus below that).
 */
export async function measurePage(page: Page): Promise<Finding[]> {
  return page.evaluate(
    ({ min, minFont }) => {
      const out: { kind: "overflow" | "target" | "input-font"; detail: string }[] = [];
      const vw = document.documentElement.clientWidth;
      const describe = (el: Element) => {
        const id = el.id ? `#${el.id}` : "";
        const cls = typeof el.className === "string" && el.className ? `.${el.className.split(/\s+/).slice(0, 2).join(".")}` : "";
        const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
        return `${el.tagName.toLowerCase()}${id}${cls} "${text}"`;
      };
      const visible = (el: Element) => (el as HTMLElement).checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) && el.getClientRects().length > 0;
      if (document.documentElement.scrollWidth > vw) out.push({ kind: "overflow", detail: `page is ${document.documentElement.scrollWidth}px wide in a ${vw}px viewport` });
      const clipped = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
        }
        return false;
      };
      let sticking = 0;
      for (const el of document.body.querySelectorAll("*")) {
        if (!visible(el) || el.closest("table") || clipped(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
          if (sticking++ < 5) out.push({ kind: "overflow", detail: `${describe(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}px` });
        }
      }
      const sel = "a[href], button, select, textarea, input:not([type=hidden]), summary, [role=button], [role=tab], [role=link]";
      for (const el of document.querySelectorAll(sel)) {
        if (!visible(el) || (el as HTMLInputElement).disabled) continue;
        const input = el as HTMLInputElement;
        const isCheck = el.tagName === "INPUT" && (input.type === "checkbox" || input.type === "radio");
        const isFile = el.tagName === "INPUT" && input.type === "file";
        const box = isCheck ? (el.closest("label") ?? el) : el;
        const r = box.getBoundingClientRect();
        const cs = getComputedStyle(el);
        // An anchor that is part of a sentence follows the text around it and is exempt from the size rule.
        let block = el.parentElement;
        while (block && getComputedStyle(block).display === "inline") block = block.parentElement;
        const parentText = block ? (block.textContent ?? "").trim().length - (el.textContent ?? "").trim().length : 0;
        const inline = el.tagName === "A" && cs.display === "inline" && parentText > 0;
        if (!inline && (r.height < min - 0.5 || (r.width < min - 0.5 && !(el.tagName === "A" && cs.display === "inline")))) {
          out.push({ kind: "target", detail: `${describe(el)} is ${Math.round(r.width)}x${Math.round(r.height)}` });
        }
        const textual = el.tagName === "SELECT" || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !isCheck && !isFile && !["button", "submit", "reset", "range", "color"].includes(input.type));
        if (textual && parseFloat(cs.fontSize) < minFont - 0.01) out.push({ kind: "input-font", detail: `${describe(el)} text is ${cs.fontSize}` });
      }
      return out;
    },
    { min: MIN_TARGET, minFont: MIN_INPUT_FONT },
  );
}

/** The routes to check, with the ids seeded above. Settings pages are owner-only and the seeded user is the owner. */
export function phoneRoutes(data: PhoneData): { name: string; path: string }[] {
  const { ids } = data;
  return [
    { name: "dashboard", path: "/" },
    { name: "customers", path: "/customers" },
    { name: "customer-new", path: "/customers/new" },
    { name: "customer-detail", path: `/customers/${ids.customer}` },
    { name: "quotations", path: "/quotations" },
    { name: "quotation-new", path: "/quotations/new" },
    { name: "quotation-draft", path: `/quotations/${ids.draft}` },
    { name: "quotation-draft-edit", path: `/quotations/${ids.draft}/revise` },
    { name: "quotation-detail", path: `/quotations/${ids.quotation}` },
    { name: "orders", path: "/orders" },
    { name: "order-new", path: `/orders/new?quotation=${ids.quotation}` },
    { name: "order-detail", path: `/orders/${ids.order}` },
    { name: "challans", path: "/challans" },
    { name: "challan-new", path: `/challans/new?order=${ids.order}` },
    { name: "challan-detail", path: `/challans/${ids.challan}` },
    { name: "products", path: "/catalog/products" },
    { name: "product-new", path: "/catalog/products/new" },
    { name: "product-detail", path: `/catalog/products/${ids.product}` },
    { name: "price-lists", path: "/catalog/price-lists" },
    { name: "brands", path: "/catalog/brands" },
    { name: "import-new", path: "/catalog/import/new" },
    ...(ids.importJob ? [{ name: "import-review", path: `/catalog/import/${ids.importJob}` }] : []),
    ...(ids.priceList ? [{ name: "price-list-detail", path: `/catalog/price-lists/${ids.priceList}` }] : []),
    { name: "settings-business", path: "/settings/business" },
    { name: "settings-numbering", path: "/settings/numbering" },
    { name: "settings-terms", path: "/settings/terms" },
    { name: "settings-users", path: "/settings/users" },
  ];
}

/**
 * The dev server draws a round "N" indicator in the bottom-left corner that sits over the first button of a
 * sticky action bar on a phone and swallows its clicks. It does not exist in a production build, so tests hide it.
 */
export async function hideDevIndicator(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  });
}
