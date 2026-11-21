import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// T081: the access rule of the app, checked from the source so a new action, page or route cannot forget it.
//  - every exported function of a "use server" file (a Server Action is a public POST endpoint) authorises before it touches data;
//  - every route handler under src/app/api (except Better Auth's own sign-in) calls authorizeRequest() before reading data;
//  - every page in the signed-in shell checks the session itself (a layout does not protect its pages), and the owner-only
//    pages ask for the owner role.
// The runtime behaviour (401s, redirects, 403s) is tested in tests/e2e/security.spec.ts.

const SRC = path.join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const rel = (file: string) => path.relative(process.cwd(), file);

/** Exported async functions with their bodies (up to the next top-level export). */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const starts = [...source.matchAll(/^export async function (\w+)/gm)];
  return starts.map((m, i) => ({ name: m[1], body: source.slice(m.index, starts[i + 1]?.index ?? source.length) }));
}

const AUTH = /\b(requireUser|requireRole|authorizeRequest)\(/;

describe("every Server Action authorises first", () => {
  const files = walk(path.join(SRC, "server")).filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")));

  it("finds the action files", () => {
    expect(files.map((f) => path.basename(f)).sort()).toEqual(
      ["catalog.ts", "challans.ts", "customers.ts", "orders.ts", "products.ts", "quotation-lookups.ts", "quotations.ts", "settings.ts", "users.ts"].sort(),
    );
  });

  for (const file of files) {
    for (const fn of exportedFunctions(readFileSync(file, "utf8"))) {
      it(`${rel(file)} › ${fn.name}`, () => {
        const auth = fn.body.search(AUTH);
        expect(auth, "calls requireUser()/requireRole()").toBeGreaterThan(-1);
        // Nothing reads or writes data before the check (`runAction(async () => { const user = await requireUser(); ...` is the usual shape).
        const firstData = fn.body.search(/\b(getDb|core\.\w+|saveDocumentUpload|saveImageUpload|cookies|headers)\(/);
        expect(firstData === -1 || auth < firstData, "authorises before reading or writing data").toBe(true);
      });
    }
  }

  // contracts/ui-routes.md: what a sales user must not do (SC-007). Everything else needs only a signed-in staff member.
  const OWNER_ONLY: Record<string, string[]> = {
    "settings.ts": ["saveBusinessProfile", "saveNumberSeries", "saveTermsTemplate", "setDefaultTermsTemplate", "deleteTermsTemplate"],
    "users.ts": ["createUser", "setUserRole", "setUserActive", "resetUserPassword"],
    "catalog.ts": ["markProductDiscontinued", "createDistributor", "createBrand", "saveBrand", "saveDistributor"],
    "products.ts": ["setProductStatus"],
  };
  for (const [fileName, names] of Object.entries(OWNER_ONLY)) {
    for (const name of names) {
      it(`${fileName} › ${name} is owner-only`, () => {
        const fn = exportedFunctions(readFileSync(path.join(SRC, "server", fileName), "utf8")).find((f) => f.name === name);
        expect(fn, `${name} exists`).toBeDefined();
        expect(fn!.body).toMatch(/requireRole\("owner"\)/);
      });
    }
  }

  it("every action in the settings and users files is owner-only (a new one cannot be added open by mistake)", () => {
    for (const fileName of ["settings.ts", "users.ts"]) {
      const names = exportedFunctions(readFileSync(path.join(SRC, "server", fileName), "utf8")).map((f) => f.name);
      expect(names.sort(), fileName).toEqual([...OWNER_ONLY[fileName]].sort());
    }
  });

  it("no file with a 'use server' directive hides in a place this test does not look", () => {
    const stray = walk(SRC).filter((f) => !f.includes(`${path.sep}server${path.sep}`) && /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
    expect(stray.map(rel)).toEqual([]);
  });
});

describe("every route handler authorises first", () => {
  const routes = walk(path.join(SRC, "app", "api")).filter((f) => path.basename(f) === "route.ts");

  it("finds the route handlers", () => {
    expect(routes.map((f) => rel(f).replace(/\\/g, "/")).sort()).toEqual([
      "src/app/api/auth/[...all]/route.ts",
      "src/app/api/documents/[kind]/[id]/pdf/route.ts",
      "src/app/api/files/[id]/route.ts",
      "src/app/api/imports/template/route.ts",
    ]);
  });

  for (const file of routes.filter((f) => !f.includes(`${path.sep}auth${path.sep}`))) {
    it(`${rel(file)} answers 401/403 through authorizeRequest() before touching data`, () => {
      const source = readFileSync(file, "utf8");
      const handler = source.slice(source.search(/export async function GET/));
      const auth = handler.indexOf("authorizeRequest(");
      expect(auth).toBeGreaterThan(-1);
      expect(handler).toMatch(/if \(auth\.response\) return auth\.response;/);
      const data = handler.search(/\b(getDb|getStorage|build\w+|await ctx\.params)\b/);
      expect(data === -1 || auth < data).toBe(true);
    });
  }
});

describe("every page in the signed-in shell checks the session", () => {
  const pages = walk(path.join(SRC, "app", "(app)")).filter((f) => path.basename(f) === "page.tsx");
  // The access-denied page is what people are sent to; it shows no data.
  const open = new Set(["src/app/(app)/forbidden/page.tsx"]);

  for (const file of pages) {
    const name = rel(file).replace(/\\/g, "/");
    it(name, () => {
      const source = readFileSync(file, "utf8");
      if (open.has(name)) return;
      expect(source).toMatch(/\brequire(User|Role)\(/);
    });
  }

  it("the owner-only screens ask for the owner role", () => {
    for (const p of ["settings/business", "settings/numbering", "settings/users", "settings/audit"]) {
      expect(readFileSync(path.join(SRC, "app", "(app)", p, "page.tsx"), "utf8"), p).toMatch(/requireRole\("owner"\)/);
    }
  });
});
