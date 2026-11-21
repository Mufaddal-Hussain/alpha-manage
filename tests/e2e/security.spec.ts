import { randomBytes } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "@/db";
import { customer, user } from "@/db/schema";
import { createStaffUser } from "@/lib/auth/create-user";

// T081 / quickstart scenario 10 / SC-007: a visitor who is not signed in reaches no page, document or file, a forged session
// cookie is no better, and a sales user reaches nothing that is owner-only. Runs against the TEST database only.
const suffix = randomBytes(4).toString("hex");
const sales = { name: "E2E SEC Sales", email: `e2e-sec-sales-${suffix}@example.test`, password: `Sales-${randomBytes(9).toString("base64url")}`, role: "sales" as const };
const SECRET_NAME = `E2E SEC Confidential Customer ${suffix}`;
const ID = "00000000-0000-4000-8000-000000000000";
let customerId: string;

test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("e2e tests must run against TEST_DATABASE_URL only");
  }
  const db = getDb();
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
  await createStaffUser(sales);
  const [c] = await db.insert(customer).values({ type: "company", displayName: SECRET_NAME, stateCode: "27", addressLine1: "Baner", city: "Pune" }).returning({ id: customer.id });
  customerId = c.id;
});

test.afterAll(async () => {
  const db = getDb();
  await db.delete(customer).where(eq(customer.id, customerId));
  await db.delete(user).where(inArray(user.email, [sales.email]));
});

const PAGES = [
  "/",
  "/customers",
  "/customers/new",
  () => `/customers/${customerId}`,
  "/quotations",
  "/quotations/new",
  `/quotations/${ID}`,
  `/quotations/${ID}/revise`,
  "/orders",
  "/orders/new",
  `/orders/${ID}`,
  "/challans",
  "/challans/new",
  `/challans/${ID}`,
  "/catalog/products",
  "/catalog/products/new",
  `/catalog/products/${ID}`,
  "/catalog/price-lists",
  `/catalog/price-lists/${ID}`,
  "/catalog/brands",
  "/catalog/import/new",
  `/catalog/import/${ID}`,
  "/settings/business",
  "/settings/numbering",
  "/settings/terms",
  "/settings/users",
  "/settings/audit",
].map((p) => (typeof p === "function" ? p : () => p));

const OWNER_ONLY = ["/settings/business", "/settings/numbering", "/settings/users", "/settings/audit"];

// Every file or document endpoint, with ids that do not exist: the answer must be 401 before anyone looks for the record.
const ENDPOINTS = [
  `/api/documents/quotation/${ID}/pdf`,
  `/api/documents/quotation/${ID}/pdf?preview=1`,
  `/api/documents/challan/${ID}/pdf`,
  `/api/documents/challan/${ID}/pdf?prices=show`,
  `/api/documents/nonsense/${ID}/pdf`,
  `/api/files/${ID}`,
  "/api/files/not-a-uuid",
  "/api/imports/template",
];

const FORGED = { cookie: "better-auth.session_token=forged-token.forged-signature; __Secure-better-auth.session_token=forged-token.forged-signature" };

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(sales.email);
  await page.getByLabel("Password").fill(sales.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 30_000 });
}

async function get(request: APIRequestContext, url: string, headers?: Record<string, string>) {
  return request.get(url, { headers, maxRedirects: 0, failOnStatusCode: false });
}

test.describe("signed out", () => {
  test("every page redirects to the sign-in page", async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const page of PAGES) {
      const url = page();
      const response = await get(request, url);
      expect(response.status(), url).toBe(307);
      expect(response.headers()["location"], url).toMatch(/\/sign-in/);
    }
    await request.dispose();
  });

  test("every document and file endpoint answers 401", async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const url of ENDPOINTS) {
      const response = await get(request, url);
      expect(response.status(), url).toBe(401);
      expect(response.headers()["content-type"], url).toContain("application/json");
    }
    await request.dispose();
  });
});

test.describe("a forged session cookie", () => {
  test("is not a session: the pages hand over no data and send the visitor to sign in", async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const page of PAGES) {
      const url = page();
      const response = await get(request, url, FORGED);
      const body = await response.text();
      // The proxy only looks for a cookie; the page itself rejects it (a streamed redirect) and sends nothing from the database.
      expect(body, url).not.toContain(SECRET_NAME);
      expect(response.status() === 307 || body.includes("NEXT_REDIRECT;replace;/sign-in"), url).toBe(true);
    }
    await request.dispose();
  });

  test("gets 401 from every document and file endpoint", async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const url of ENDPOINTS) expect((await get(request, url, FORGED)).status(), url).toBe(401);
    await request.dispose();
  });
});

test.describe("a sales user", () => {
  test("is sent to the access-denied page by every owner-only screen", async ({ page }) => {
    await signIn(page);
    for (const url of OWNER_ONLY) {
      await page.goto(url);
      await expect(page, url).toHaveURL(/\/forbidden$/);
      await expect(page.getByRole("heading", { name: /do not have access/i })).toBeVisible();
    }
  });

  test("can use the shared screens", async ({ page }) => {
    await signIn(page);
    for (const url of ["/", "/customers", "/quotations", "/orders", "/challans", "/catalog/products", "/settings/terms"]) {
      await page.goto(url);
      await expect(page, url).not.toHaveURL(/\/(forbidden|sign-in)/);
    }
  });

  test("is not offered the owner-only actions in the navigation", async ({ page }) => {
    await signIn(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Business profile", "Numbering", "Users", "Audit log"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
  });

  test("can read documents but still gets 404, not data, for ids that do not exist", async ({ page }) => {
    await signIn(page);
    for (const url of [`/api/documents/quotation/${ID}/pdf`, `/api/documents/challan/${ID}/pdf`, `/api/files/${ID}`]) {
      expect((await page.request.get(url)).status(), url).toBe(404);
    }
  });
});

test.describe("the auth endpoints", () => {
  test("do not allow self-registration", async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    const email = `e2e-sec-signup-${suffix}@example.test`;
    const response = await request.post("/api/auth/sign-up/email", {
      data: { name: "Intruder", email, password: "Intruder-password-123", role: "owner" },
      headers: { origin: baseURL! },
      failOnStatusCode: false,
    });
    expect(response.ok(), `sign-up answered ${response.status()}`).toBe(false);
    expect(await getDb().select({ id: user.id }).from(user).where(eq(user.email, email))).toHaveLength(0);
    await request.dispose();
  });

  test("do not let a signed-in sales user make themselves an owner", async ({ page }) => {
    await signIn(page);
    const origin = new URL(page.url()).origin;
    await page.request.post("/api/auth/update-user", { data: { name: "E2E SEC Sales", role: "owner", active: false }, headers: { origin }, failOnStatusCode: false });
    const [row] = await getDb().select({ role: user.role, active: user.active }).from(user).where(eq(user.email, sales.email));
    expect(row).toEqual({ role: "sales", active: true });
    await page.goto("/settings/users");
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});
