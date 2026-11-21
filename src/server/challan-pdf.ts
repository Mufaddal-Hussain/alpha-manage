import type { Database } from "@/db";
import { challanFileName } from "@/lib/pdf/challan";
import { loadChallanPdfData } from "@/lib/pdf/challan-data";
import { renderChallanPdf } from "@/lib/pdf/render-challan";

export type ChallanPdfResult = { status: "ok"; bytes: Buffer; fileName: string } | { status: "not_found" };

/**
 * The PDF of a challan, rendered on request. Unlike quotations it is not cached: a challan changes state (cancelled),
 * the prices option changes the output per print, and rendering one page is quick. `showPrices` defaults to the
 * challan's own setting. A cancelled challan renders with a CANCELLED mark.
 */
export async function getChallanPdf(db: Database, id: string, options: { showPrices?: boolean } = {}): Promise<ChallanPdfResult> {
  const data = await loadChallanPdfData(db, id);
  if (!data) return { status: "not_found" };
  const bytes = await renderChallanPdf(data, options.showPrices ?? data.challan.showPrices);
  return { status: "ok", bytes, fileName: challanFileName(data.challan.number) };
}
