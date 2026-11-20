import { renderToBuffer } from "@react-pdf/renderer";
import type { QuotationLayout } from "@/db/schema";
import { ensureFonts } from "@/lib/pdf/fonts";
import { QuotationEstimateDocument } from "@/lib/pdf/quotation-estimate";
import { QuotationGstDocument } from "@/lib/pdf/quotation-gst";
import type { QuotationPdfData } from "@/lib/pdf/quotation-data";

/** Renders a quotation to PDF bytes in the requested layout. */
export async function renderQuotationPdf(data: QuotationPdfData, layout: QuotationLayout): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(layout === "estimate" ? <QuotationEstimateDocument data={data} /> : <QuotationGstDocument data={data} />);
}
