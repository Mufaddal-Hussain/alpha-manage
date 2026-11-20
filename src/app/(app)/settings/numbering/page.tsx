import { NumberingForm } from "@/components/settings/numbering-form";
import { requireRole } from "@/lib/auth/session";
import { getNumberSeriesStatus } from "@/server/settings-queries";

export const metadata = { title: "Numbering · alpha-Manage" };

export default async function NumberingSettingsPage() {
  await requireRole("owner");
  const series = await getNumberSeriesStatus();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Numbering</h1>
        <p className="mt-1 text-sm text-muted">
          Numbers are gap-free and restart on 1 April. A number is only taken when a document is issued, never for drafts.
        </p>
      </div>
      {series.map((s) => (
        <NumberingForm key={s.series} status={s} />
      ))}
    </>
  );
}
