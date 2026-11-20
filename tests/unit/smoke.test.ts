import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

describe("smoke", () => {
  it("uses exact decimal arithmetic (no float drift)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(new Decimal("0.1").plus("0.2").toFixed(2)).toBe("0.30");
  });

  it("resolves the @/ alias and validates environment variables", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/alpha_manage",
      AUTH_SECRET: "x".repeat(32),
    });
    expect(env.STORAGE_DRIVER).toBe("local");
  });

  it("rejects incomplete environments", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgres://localhost/db" })).toThrow(/AUTH_SECRET/);
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgres://localhost/db",
        AUTH_SECRET: "x".repeat(32),
        STORAGE_DRIVER: "vercel-blob",
      }),
    ).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });
});
