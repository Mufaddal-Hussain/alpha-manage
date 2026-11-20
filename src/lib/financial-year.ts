const IST_PARTS = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "numeric",
});

/** "2026-27" for a starting year of 2026. */
export function financialYearLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * Indian financial year (1 April to 31 March) containing the instant, judged in India time
 * (Asia/Kolkata) so a late-night entry on 31 March does not land in the next year.
 */
export function financialYearOf(date: Date): string {
  const parts = IST_PARTS.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return financialYearLabel(month >= 4 ? year : year - 1);
}
