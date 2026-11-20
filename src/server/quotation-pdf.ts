import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { file, quotationRevision, type QuotationLayout } from "@/db/schema";
import { quotationFileName } from "@/lib/pdf/quotation-gst";
import { loadQuotationPdfData } from "@/lib/pdf/quotation-data";
import { renderQuotationPdf } from "@/lib/pdf/render-quotation";
import { getStorage } from "@/lib/storage";

export type QuotationPdfResult =
  | { status: "ok"; bytes: Buffer; fileName: string; cached: boolean }
  | { status: "not_found" }
  /** Unissued revision requested without `preview`: it has no number yet (contracts/http-endpoints.md: 409). */
  | { status: "draft" };

async function readCached(db: Database, fileId: string): Promise<{ bytes: Buffer; createdAt: Date } | null> {
  const [row] = await db.select().from(file).where(eq(file.id, fileId)).limit(1);
  if (!row) return null;
  const stored = await getStorage().get(row.storageKey);
  if (!stored) return null;
  return { bytes: Buffer.from(await new Response(stored.stream).arrayBuffer()), createdAt: row.createdAt };
}

/**
 * The PDF of a quotation revision. An issued revision rendered in its own layout is cached in file storage and
 * served from there until the revision changes (every change clears `pdf_file_id`) or the business profile (name,
 * address, logo) is edited after the cache was made. Other layouts and drafts are rendered on request.
 */
export async function getQuotationPdf(
  db: Database,
  id: string,
  options: { revisionNo?: number; layout?: QuotationLayout; preview?: boolean },
): Promise<QuotationPdfResult> {
  const data = await loadQuotationPdfData(db, id, options.revisionNo);
  if (!data) return { status: "not_found" };
  if (data.draft && !options.preview) return { status: "draft" };

  const revision = data.revision;
  const layout = options.layout ?? revision.layout;
  const fileName = quotationFileName(data.number, revision.revisionNo);
  const cacheable = !data.draft && layout === revision.layout;

  if (cacheable && revision.pdfFileId && revision.pdfLayout === layout) {
    const cached = await readCached(db, revision.pdfFileId);
    if (cached && cached.createdAt >= data.businessUpdatedAt) return { status: "ok", bytes: cached.bytes, fileName, cached: true };
  }

  const bytes = await renderQuotationPdf(data, layout);

  if (cacheable) {
    try {
      const storageKey = `documents/quotation/${revision.id}/${randomUUID()}.pdf`;
      await getStorage().put(storageKey, bytes, { contentType: "application/pdf" });
      const [saved] = await db
        .insert(file)
        .values({ storageKey, originalName: fileName, mimeType: "application/pdf", size: bytes.length })
        .returning({ id: file.id });
      await db.update(quotationRevision).set({ pdfFileId: saved.id, pdfLayout: layout }).where(eq(quotationRevision.id, revision.id));
      if (revision.pdfFileId) {
        const [old] = await db.delete(file).where(eq(file.id, revision.pdfFileId)).returning({ storageKey: file.storageKey });
        if (old) await getStorage().delete(old.storageKey);
      }
    } catch (error) {
      // The cache is an optimisation: a storage hiccup must not stop the person getting their PDF.
      console.error("[pdf] could not cache the quotation PDF", error);
    }
  }
  return { status: "ok", bytes, fileName, cached: false };
}
