import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { brand, priceList } from "@/db/schema";
import { cleanupPhoneData, hideDevIndicator, measurePage, phoneRoutes, seedPhoneData, signInAs, SLOW, uploadPriceList, type Finding, type PhoneData } from "./support/phone";

// T087: visits every screen at phone width (375, 390 and 430 px, one Playwright project each) and measures horizontal
// overflow, touch targets under 44 px and input text under 16 px. Without PHONE_AUDIT set it is a regression check and
// fails on any finding. With PHONE_AUDIT=1 it only writes what it found to .phone-audit/<width>.txt, which is
// how the audit in docs/phone/audit.md was produced. Runs against the TEST database only.
test.setTimeout(600_000);
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

test("every screen fits a phone", async ({ page }, info) => {
  const width = page.viewportSize()!.width;
  const d = data!;
  await signInAs(page, d.owner);

  // A price-list import to review, approved afterwards so the price-list detail page has something to show.
  d.ids.importJob = await uploadPriceList(page, d.suffix);
  const report: string[] = [];
  const check = async (name: string, route: string, prepare?: () => Promise<void>) => {
    await page.goto(route);
    await expect(page.locator("main:visible").first()).toBeVisible(SLOW);
    await page.waitForLoadState("networkidle").catch(() => {});
    await prepare?.();
    const found = await measurePage(page);
    report.push(`## ${name} (${route})`, ...(found.length ? found.map((f: Finding) => `- ${f.kind}: ${f.detail}`) : ["- ok"]), "");
    return found.map((f) => `${name}: ${f.kind}: ${f.detail}`);
  };

  const problems: string[] = [];
  for (const r of phoneRoutes(d)) problems.push(...(await check(r.name, r.path)));
  // Approve the import (the review page was just checked) and look at the price list it created.
  await page.goto(`/catalog/import/${d.ids.importJob}`);
  await page.getByRole("button", { name: "Approve import" }).click();
  await expect(page.getByText("Import approved").first()).toBeVisible(SLOW);
  const [brandRow] = await getDb().select({ id: brand.id }).from(brand).where(like(brand.name, `E2E PH ${d.suffix} %`)).limit(1);
  const [list] = await getDb().select({ id: priceList.id }).from(priceList).where(eq(priceList.brandId, brandRow.id)).limit(1);
  problems.push(...(await check("price-list-detail", `/catalog/price-lists/${list.id}`)));
  problems.push(...(await check("sign-in", "/sign-in")));
  // The navigation menu open (phones show it as a panel): its links are touch targets too.
  problems.push(
    ...(await check("menu-open", "/", async () => {
      await page.getByRole("button", { name: /menu/i }).click();
      await expect(page.locator("#mobile-menu")).toBeVisible();
    })),
  );

  if (process.env.PHONE_AUDIT) {
    mkdirSync(".phone-audit", { recursive: true });
    writeFileSync(path.join(".phone-audit", `${width}.txt`), `# Phone audit at ${width}px (${info.project.name})\n\n${report.join("\n")}\n`);
    return;
  }
  expect(problems, problems.join("\n")).toEqual([]);
});
