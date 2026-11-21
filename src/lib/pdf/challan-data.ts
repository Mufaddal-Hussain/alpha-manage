import type { Database } from "@/db";
import type { ChallanLine, DeliveryChallan } from "@/db/schema";
import { loadPdfBranding, type PdfBranding } from "@/lib/pdf/quotation-data";
import { getChallanDetail } from "@/server/challan-queries";

// Everything a challan PDF needs, read once. Business details come from `business_profile` (never hard-coded); the
// challan figures come from the challan's own snapshots, so a printed challan never changes when the customer or the
// product does (FR-031).

export interface ChallanPdfData extends PdfBranding {
  challan: DeliveryChallan;
  lines: ChallanLine[];
  customerPoNumber: string;
  quotationNumber: string | null;
}

export async function loadChallanPdfData(db: Database, id: string): Promise<ChallanPdfData | null> {
  const detail = await getChallanDetail(db, id);
  if (!detail) return null;
  const branding = await loadPdfBranding(db);
  if (!branding) return null;
  return { ...branding, challan: detail.challan, lines: detail.lines, customerPoNumber: detail.customerPoNumber, quotationNumber: detail.quotationNumber };
}
