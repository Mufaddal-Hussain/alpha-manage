import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { file, type FileRecord } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { getStorage } from "./index";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** First bytes of each accepted image type; the browser-supplied MIME type alone is not trusted. */
function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-80);
  return cleaned || "file";
}

/** Validates an uploaded image, stores its bytes and records it in the `file` table. */
export async function saveImageUpload(upload: File, uploadedBy: string, options: { maxBytes?: number } = {}): Promise<FileRecord> {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  if (upload.size === 0) throw new ValidationError("The selected file is empty");
  if (upload.size > maxBytes) {
    throw new ValidationError(`The image is too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB)`);
  }
  const bytes = Buffer.from(await upload.arrayBuffer());
  const detected = sniffImageType(bytes);
  if (!detected) throw new ValidationError("Only PNG, JPEG or WebP images are accepted");

  const storageKey = `uploads/${randomUUID()}/${safeName(upload.name)}`;
  await getStorage().put(storageKey, bytes, { contentType: detected });
  try {
    const [row] = await getDb()
      .insert(file)
      .values({ storageKey, originalName: safeName(upload.name), mimeType: detected, size: bytes.length, uploadedBy })
      .returning();
    return row;
  } catch (error) {
    await getStorage().delete(storageKey); // do not leave an orphan blob behind
    throw error;
  }
}

/** Removes a file row and its stored bytes (used when a logo is replaced). Missing rows are ignored. */
export async function deleteStoredFile(fileId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.delete(file).where(eq(file.id, fileId)).returning({ storageKey: file.storageKey });
  if (row) await getStorage().delete(row.storageKey);
}

/** Spreadsheet and PDF uploads for price lists (T059): the template to import and the distributor's PDF kept for reference. */
export const DOCUMENT_KINDS = {
  /** The Excel/CSV template that is read by the import. */
  template: { maxBytes: 5 * 1024 * 1024, label: "template" },
  /** The distributor's original PDF: attached to a price list for reference, never read by the system (FR-007). */
  reference: { maxBytes: 15 * 1024 * 1024, label: "PDF" },
} as const;

/** Detects what an uploaded document really is from its first bytes and its name; the browser's MIME type is not trusted. */
function sniffDocument(bytes: Buffer, name: string, kind: keyof typeof DOCUMENT_KINDS): string | null {
  const lower = name.toLowerCase();
  if (kind === "reference") {
    return lower.endsWith(".pdf") && bytes.subarray(0, 5).toString("ascii") === "%PDF-" ? "application/pdf" : null;
  }
  if (lower.endsWith(".xlsx") && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".csv") && !bytes.includes(0)) return "text/csv";
  return null;
}

/** Validates an uploaded template or reference PDF, stores its bytes and records it in the `file` table. */
export async function saveDocumentUpload(upload: File, uploadedBy: string, kind: keyof typeof DOCUMENT_KINDS): Promise<{ record: FileRecord; bytes: Buffer }> {
  const { maxBytes, label } = DOCUMENT_KINDS[kind];
  if (upload.size === 0) throw new ValidationError("The selected file is empty");
  if (upload.size > maxBytes) throw new ValidationError(`The ${label} is too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB)`);
  const bytes = Buffer.from(await upload.arrayBuffer());
  const detected = sniffDocument(bytes, upload.name, kind);
  if (!detected) {
    throw new ValidationError(kind === "reference" ? "The reference file must be a PDF" : "Choose the price-list template as an .xlsx or .csv file");
  }
  const storageKey = `uploads/${randomUUID()}/${safeName(upload.name)}`;
  await getStorage().put(storageKey, bytes, { contentType: detected });
  try {
    const [record] = await getDb()
      .insert(file)
      .values({ storageKey, originalName: safeName(upload.name), mimeType: detected, size: bytes.length, uploadedBy })
      .returning();
    return { record, bytes };
  } catch (error) {
    await getStorage().delete(storageKey);
    throw error;
  }
}
