import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getPriceListDetail } from "@/server/catalog-queries";

export const metadata = { title: "Price list · alpha-Manage" };

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const DESIGN_STYLE = { new: "text-success", changed: "text-amber-700 dark:text-amber-400", unchanged: "" } as const;

export default async function PriceListPage({ params }: PageProps<"/catalog/price-lists/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await getPriceListDetail(id);
  if (!detail) notFound();
  const { list, previous, groups, removed, sourceFileName, referenceFileName } = detail;

  const changedCount = groups.reduce((n, g) => n + (g.diff?.designs.filter((d) => d.kind === "changed").length ?? 0), 0);
  const newCount = groups.reduce((n, g) => n + (g.diff?.designs.filter((d) => d.kind === "new").length ?? 0), 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <Link href="/catalog/price-lists" className="tap text-sm text-muted hover:underline">
          ← Price lists
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {list.brandName} {list.label ? `· ${list.label}` : ""} · w.e.f. {list.effectiveFrom}
          <span className="ml-3 rounded-full border border-border px-2 py-0.5 align-middle text-xs font-normal text-muted">
            {list.status === "published" ? "Current" : list.status === "superseded" ? "Superseded" : "Draft"}
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          Imported {list.importedAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}.
          {list.referenceFileId ? (
            <>
              {" "}
              Reference PDF:{" "}
              <a href={`/api/files/${list.referenceFileId}`} className="text-accent hover:underline">
                {referenceFileName ?? "Open"}
              </a>
              .
            </>
          ) : (
            " No reference PDF attached."
          )}
          {list.sourceFileId ? (
            <>
              {" "}
              <a href={`/api/files/${list.sourceFileId}`} className="text-accent hover:underline">
                Import file{sourceFileName ? ` (${sourceFileName})` : ""}
              </a>
              .
            </>
          ) : null}
          {list.importJobId ? (
            <>
              {" "}
              <Link href={`/catalog/import/${list.importJobId}`} className="text-accent hover:underline">
                See the import
              </Link>
              .
            </>
          ) : null}
        </p>
        {previous ? (
          <p className="mt-2 text-sm">
            Compared with the previous version{" "}
            <Link href={`/catalog/price-lists/${previous.id}`} className="text-accent hover:underline">
              {previous.label ? `${previous.label} · ` : ""}w.e.f. {previous.effectiveFrom}
            </Link>
            : {changedCount} changed, {newCount} new, {removed.reduce((n, g) => n + g.designs.length, 0)} no longer listed.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">This is the first version of this brand&apos;s list.</p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((g) => {
          const rateChange = g.diff?.designs.find((d) => d.kind === "changed")?.previousRatePerBox;
          return (
            <section key={g.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">
                  {g.sizeLabel} · {g.finish}
                </h2>
                <p className="text-sm">
                  <span className="font-medium">{inr.format(Number(g.ratePerBox))}</span> / box ·{" "}
                  <span className="text-muted">{inr.format(Number(g.ratePerSqft))} / sq.ft</span>
                  {rateChange ? <span className="ml-2 text-amber-700 dark:text-amber-400">was {inr.format(Number(rateChange))} / box</span> : null}
                </p>
              </div>
              <p className="text-xs text-muted">
                {g.piecesPerBox} pcs, {Number(g.sqftPerBox)} sq.ft per box
              </p>
              <p className="mt-2 text-sm">
                {(g.diff?.designs ?? g.designs.map((name) => ({ name, kind: "unchanged" as const }))).map((d, i) => (
                  <span key={d.name} className={DESIGN_STYLE[d.kind]}>
                    {i > 0 ? ", " : ""}
                    {d.name}
                    {d.kind === "new" ? " (new)" : ""}
                  </span>
                ))}
              </p>
            </section>
          );
        })}
      </div>

      {removed.length > 0 ? (
        <section>
          <h2 className="text-lg font-medium">In the previous version, not in this one</h2>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
            {removed.map((g) => (
              <li key={`${g.sizeLabel}-${g.finish}-${g.ratePerBox}`} className="px-4 py-3 text-sm">
                <span className="font-medium">
                  {g.sizeLabel} · {g.finish}
                </span>{" "}
                <span className="text-muted">({inr.format(Number(g.ratePerBox))} / box)</span>: {g.designs.join(", ")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
