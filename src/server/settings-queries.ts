import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { businessProfile, numberSeries, termsTemplate, type NumberSeriesKind } from "@/db/schema";
import { financialYearOf } from "@/lib/financial-year";
import { DEFAULT_FORMATS } from "@/lib/numbering";

// Reads for the settings pages. Callers authorise first (requireUser/requireRole in the page).

export async function getBusinessProfile() {
  const [row] = await getDb().select().from(businessProfile).limit(1);
  return row ?? null;
}

export async function listTermsTemplates() {
  return getDb().select().from(termsTemplate).orderBy(asc(termsTemplate.name));
}

/** Series shown in settings (invoice and receipt arrive with later modules). */
export const CONFIGURABLE_SERIES: { series: NumberSeriesKind; label: string }[] = [
  { series: "quotation", label: "Quotation" },
  { series: "challan", label: "Delivery challan" },
];

export interface SeriesStatus {
  series: NumberSeriesKind;
  label: string;
  format: string;
  financialYear: string;
  lastValue: number;
}

/** Current format and counter for each configurable series in the current financial year. */
export async function getNumberSeriesStatus(now = new Date()): Promise<SeriesStatus[]> {
  const financialYear = financialYearOf(now);
  const rows = await getDb().select().from(numberSeries).orderBy(asc(numberSeries.financialYear));
  return CONFIGURABLE_SERIES.map(({ series, label }) => {
    const forSeries = rows.filter((r) => r.series === series);
    const current = forSeries.find((r) => r.financialYear === financialYear);
    const latest = forSeries.at(-1);
    return {
      series,
      label,
      financialYear,
      format: current?.format ?? latest?.format ?? DEFAULT_FORMATS[series],
      lastValue: current?.lastValue ?? 0,
    };
  });
}

export async function getDefaultTermsTemplate() {
  const [row] = await getDb().select().from(termsTemplate).where(eq(termsTemplate.isDefault, true)).limit(1);
  return row ?? null;
}
