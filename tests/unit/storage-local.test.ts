import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/storage/local";
import type { StorageAdapter } from "@/lib/storage/types";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return Buffer.from(await new Response(stream).arrayBuffer()).toString("utf8");
}

describe("LocalStorage", () => {
  let dir: string;
  let storage: StorageAdapter;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "alpha-storage-"));
    storage = new LocalStorage(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores bytes under a nested key and reads them back", async () => {
    await storage.put("uploads/abc/logo.png", Buffer.from("hello"), { contentType: "image/png" });
    const found = await storage.get("uploads/abc/logo.png");
    expect(found).not.toBeNull();
    expect(found?.size).toBe(5);
    expect(await readAll(found!.stream)).toBe("hello");
  });

  it("returns null for a key that does not exist", async () => {
    expect(await storage.get("uploads/missing/file.pdf")).toBeNull();
  });

  it("deletes a stored file and tolerates deleting twice", async () => {
    await storage.put("uploads/del/a.txt", Buffer.from("x"), { contentType: "text/plain" });
    await storage.delete("uploads/del/a.txt");
    expect(await storage.get("uploads/del/a.txt")).toBeNull();
    await expect(storage.delete("uploads/del/a.txt")).resolves.toBeUndefined();
  });

  it("refuses keys that escape the storage directory", async () => {
    await expect(storage.put("../escape.txt", Buffer.from("x"), { contentType: "text/plain" })).rejects.toThrow(/key/i);
    await expect(storage.get("/etc/passwd")).rejects.toThrow(/key/i);
    await expect(storage.get("a/../../b")).rejects.toThrow(/key/i);
  });
});
