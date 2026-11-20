import { describe, expect, it } from "vitest";
import { roleAllows, safeNextPath } from "@/lib/auth/roles";

describe("roleAllows", () => {
  it("lets the owner do everything", () => {
    expect(roleAllows("owner", ["owner"])).toBe(true);
    expect(roleAllows("owner", ["sales"])).toBe(true);
  });

  it("limits sales to what is explicitly allowed for sales", () => {
    expect(roleAllows("sales", ["sales"])).toBe(true);
    expect(roleAllows("sales", ["owner"])).toBe(false);
  });

  it("denies unknown roles", () => {
    expect(roleAllows("intern", ["sales"])).toBe(false);
    expect(roleAllows(undefined, ["sales"])).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/quotations?status=sent")).toBe("/quotations?status=sent");
  });

  it("falls back to / for anything that could leave the site", () => {
    expect(safeNextPath("https://evil.example/x")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });

  it("does not bounce back to the sign-in page", () => {
    expect(safeNextPath("/sign-in")).toBe("/");
    expect(safeNextPath("/sign-in?next=/x")).toBe("/");
  });
});
