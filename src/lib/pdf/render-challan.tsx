import { renderToBuffer } from "@react-pdf/renderer";
import { ChallanDocument } from "@/lib/pdf/challan";
import type { ChallanPdfData } from "@/lib/pdf/challan-data";
import { ensureFonts } from "@/lib/pdf/fonts";

/** Renders a challan to PDF bytes. `showPrices` decides whether rates, tax and totals are printed. */
export async function renderChallanPdf(data: ChallanPdfData, showPrices: boolean): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<ChallanDocument data={data} showPrices={showPrices} />);
}
