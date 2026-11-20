import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { assertSafeKey, type StorageAdapter, type StoredObject } from "./types";

/** Local-disk storage for development and self-hosting. Files are private: only served through /api/files/[id]. */
export class LocalStorage implements StorageAdapter {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    return target;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async get(key: string): Promise<StoredObject | null> {
    const target = this.resolve(key);
    try {
      const info = await stat(target);
      if (!info.isFile()) return null;
      return { stream: Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>, size: info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
