import { del, get, put } from "@vercel/blob";
import { assertSafeKey, type StorageAdapter, type StoredObject } from "./types";

/**
 * Vercel Blob with private access: objects have no public URL and are only reachable through
 * the authorised /api/files/[id] route handler. Uses BLOB_READ_WRITE_TOKEN from the environment.
 */
export class VercelBlobStorage implements StorageAdapter {
  async put(key: string, body: Buffer, options: { contentType: string }): Promise<void> {
    assertSafeKey(key);
    await put(key, body, {
      access: "private",
      contentType: options.contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    assertSafeKey(key);
    const result = await get(key, { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    return { stream: result.stream, size: result.blob.size ?? undefined };
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await del(key);
  }
}
