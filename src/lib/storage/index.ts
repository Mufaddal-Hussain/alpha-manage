import { getEnv } from "@/lib/env";
import { LocalStorage } from "./local";
import type { StorageAdapter } from "./types";
import { VercelBlobStorage } from "./vercel-blob";

export type { StorageAdapter, StoredObject } from "./types";

let cached: StorageAdapter | undefined;

/** Storage backend chosen by STORAGE_DRIVER: "vercel-blob" on Vercel, "local" for development and self-hosting. */
export function getStorage(): StorageAdapter {
  if (!cached) {
    const env = getEnv();
    cached = env.STORAGE_DRIVER === "vercel-blob" ? new VercelBlobStorage() : new LocalStorage(env.STORAGE_LOCAL_DIR);
  }
  return cached;
}
