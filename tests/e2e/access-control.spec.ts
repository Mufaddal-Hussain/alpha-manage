import { randomBytes } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import { createStaffUser } from "@/lib/auth/create-user";

// Users are created straight in the TEST database: playwright.config.ts points DATABASE_URL (for these
// workers and for the app server) at TEST_DATABASE_URL, and the check below refuses to run otherwise.
const suffix = randomBytes(4).toString("hex");
const owner = { name: "E2E Owner", email: `e2e-owner-${suffix}@example.test`, password: `Owner-${randomBytes(9).toString("base64url")}`, role: "owner" as const };
const sales = { name: "E2E Sales", email: `e2e-sales-${suffix}@example.test`, password: `Sales-${randomBytes(9).toString("base64url")}`, role: "sales" as const };

test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("e2e tests must run against TEST_DATABASE_URL only");
  }
  await migrate(getDb(), { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
  await createStaffUser(owner);
  await createStaffUser(sales);
});

test.afterAll(async () => {
  // Sessions and accounts cascade; audit rows keep their text with the user set to null.
  await getDb().delete(user).where(inArray(user.email, [owner.email, sales.email]));
});

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a signed-out visit to /customers is sent to the sign-in page", async ({ page }) => {
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a sales user has no access to /settings/users or /settings/business", async ({ page }) => {
  await signIn(page, sales);

  for (const path of ["/settings/users", "/settings/business"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /do not have access/i })).toBeVisible();
  }

  // Owner-only screens are not even offered in the navigation.
  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Customers" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Business profile" })).toHaveCount(0);
});

test("the owner can open /settings/users and sees it in the navigation", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/settings\/users$/);
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Users" })).toBeVisible();
});
