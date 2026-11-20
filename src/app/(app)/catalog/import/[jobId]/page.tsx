import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ApproveForm, FixRowForm } from "@/components/catalog/import-review";
import type { ImportRow } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { getImportJobDetail } from "@/server/catalog-queries";
import { setImportRowDecision } from "@/server/catalog";

export const metadata = { title: "Review import · alpha-Manage" };

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const KIND_STYLE = {
  new: "border-success/50 bg-success/10 text-success",
  changed: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  unchanged: "border-border text-muted",
  error: "border-danger/50 bg-danger/10 text-danger",
  removed: "border-border text-muted",
} as const;
const KIND_LABEL = { new: "New", changed: "Changed", unchanged: "Unchanged", error: "Error", removed: "Removed" } as const;
const DESIGN_STYLE = { new: "text-success", changed: "text-amber-700 dark:text-amber-400", unchanged: "text-muted" } as const;

function Badge({ kind }: { kind: ImportRow["kind"] }) {
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${KIND_STYLE[kind]}`}>{KIND_LABEL[kind]}</span>;
}

function DecisionForm({ rowId, accepted, onLabel, offLabel }: { rowId: string; accepted: boolean; onLabel: string; offLabel: string }) {
  return (
    <form action={setImportRowDecision}>
      <input type="hidden" name="rowId" value={rowId} />
      <input type="hidden" name="accepted" value={accepted ? "0" : "1"} />
      <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60">
        {accepted ? offLabel : onLabel}
      </button>
    </form>
  );
}

export default async function ImportReviewPage({ params }: PageProps<"/catalog/import/[jobId]">) {
  await requireUser();
  const { jobId } = await params;
  if (!z.uuid().safeParse(jobId).success) notFound();
  const detail = await getImportJobDetail(jobId);
  if (!detail) notFound();
  const { job, rows, lists, sourceFile, referenceFile, expectedBrand } = detail;

  const groupRows = rows.filter((r) => r.kind !== "removed");
  const removed = rows.filter((r) => r.kind === "removed");
  const count = (kind: ImportRow["kind"]) => rows.filter((r) => r.kind === kind).length;
  const included = groupRows.filter((r) => r.accepted && r.kind !== "error").length;
  const discontinuing = removed.filter((r) => r.accepted).length;
  const reviewing = job.status === "needs_review";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <Link href="/catalog/import/new" className="text-sm text-muted hover:underline">
          ← Imports
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{job.sourceName}</h1>
        <p className="mt-1 text-sm text-muted">
          {job.status === "needs_review" ? "Review the rows below. Nothing is saved to the catalog until you approve." : null}
          {job.status === "approved" ? "Approved. The rows below were added to the catalog." : null}
          {job.status === "failed" ? "This file could not be read." : null}
          {expectedBrand ? ` Started for ${expectedBrand}.` : ""}
          {sourceFile?.name ? (
            <>
              {" "}
              <a href={`/api/files/${sourceFile.id}`} className="text-accent hover:underline">
                Download the file
              </a>
              .
            </>
          ) : null}
          {referenceFile?.name ? (
            <>
              {" "}
              Reference PDF:{" "}
              <a href={`/api/files/${referenceFile.id}`} className="text-accent hover:underline">
                {referenceFile.name}
              </a>
              .
            </>
          ) : null}
        </p>
      </div>

      {job.status === "failed" ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {job.errorSummary}
          <p className="mt-2">
            <Link href="/catalog/import/new" className="font-medium underline">
              Try again with the template
            </Link>
          </p>
        </div>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2 text-sm" aria-label="Summary">
            {(["new", "changed", "unchanged", "error", "removed"] as const).map((kind) => (
              <li key={kind} className={`rounded-full border px-3 py-1 ${KIND_STYLE[kind]}`}>
                {count(kind)} {KIND_LABEL[kind].toLowerCase()}
              </li>
            ))}
          </ul>

          {job.status === "approved" ? (
            <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
              <p className="font-medium text-success">Import approved</p>
              <ul className="mt-2 list-disc pl-5">
                {lists.map((l) => (
                  <li key={l.id}>
                    <Link href={`/catalog/price-lists/${l.id}`} className="text-accent hover:underline">
                      {l.brandName} {l.label ?? l.effectiveFrom}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                <Link href="/catalog/products?review=1" className="text-accent hover:underline">
                  Products whose cost changed and need a selling-price review
                </Link>
              </p>
            </div>
          ) : null}

          {reviewing ? <ApproveForm jobId={job.id} included={included} discontinuing={discontinuing} /> : null}

          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Brand and group</th>
                  <th className="px-3 py-2">Rates (ex-GST)</th>
                  <th className="px-3 py-2">Designs</th>
                  {reviewing ? <th className="px-3 py-2">Include</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {groupRows.map((r) => {
                  const g = r.payload.row;
                  const raw = r.raw;
                  const counts = (["new", "changed", "unchanged"] as const).map((k) => [k, r.payload.designs.filter((d) => d.kind === k).length] as const).filter(([, n]) => n > 0);
                  return (
                    <tr key={r.id} data-kind={r.kind} className={r.accepted || r.kind === "error" || !reviewing ? "" : "opacity-60"}>
                      <td className="px-3 py-2 text-muted">{r.rowNumber}</td>
                      <td className="px-3 py-2">
                        <Badge kind={r.kind} />
                        {r.payload.brandIsNew ? <p className="mt-1 text-xs text-muted">New brand, created on approval</p> : null}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium">{g ? g.brand : raw.brand || "—"}</p>
                        <p className="text-muted">
                          {g
                            ? `${g.size} · ${g.piecesPerBox} pcs, ${Number(g.sqftPerBox)} sq.ft per box · ${g.finish}`
                            : [raw.size, raw.pieces_per_box ? `${raw.pieces_per_box} pcs` : null, raw.sqft_per_box ? `${raw.sqft_per_box} sq.ft` : null, raw.finish].filter(Boolean).join(" · ") || "—"}
                        </p>
                        {g ? (
                          <p className="text-xs text-muted">
                            {g.listLabel ? `${g.listLabel} · ` : ""}w.e.f. {g.effectiveFrom}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {g ? (
                          <>
                            <p>{inr.format(Number(g.ratePerBox))} / box</p>
                            <p className="text-muted">{inr.format(Number(g.ratePerSqft))} / sq.ft</p>
                          </>
                        ) : (
                          <p className="text-muted">
                            {raw.rate_per_box || "—"} / {raw.rate_per_sqft || "—"}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {g ? (
                          <details>
                            <summary className="cursor-pointer">
                              {g.designs.length} {g.designs.length === 1 ? "design" : "designs"}
                              {counts.length > 0 ? <span className="text-muted"> · {counts.map(([k, n]) => `${n} ${k}`).join(", ")}</span> : null}
                            </summary>
                            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                              {r.payload.designs.map((d) => (
                                <li key={d.name} className={DESIGN_STYLE[d.kind]}>
                                  {d.name}
                                  {d.kind === "changed" && d.previousRatePerBox ? ` (was ${inr.format(Number(d.previousRatePerBox))})` : ""}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : (
                          <p className="max-w-xs text-muted">{raw.designs ? `${raw.designs.split(";").filter((x) => x.trim()).length} designs` : "—"}</p>
                        )}
                        {r.message ? (
                          <p role="alert" className="mt-2 text-danger">
                            {r.message}
                          </p>
                        ) : null}
                        {r.payload.warnings.map((w) => (
                          <p key={w} className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                            Warning: {w}
                          </p>
                        ))}
                        {reviewing ? (
                          <div className="mt-2">
                            <FixRowForm rowId={r.id} raw={r.raw} />
                          </div>
                        ) : null}
                      </td>
                      {reviewing ? (
                        <td className="px-3 py-2">
                          {r.kind === "error" ? <span className="text-xs text-muted">Fix first</span> : <DecisionForm rowId={r.id} accepted={r.accepted} onLabel="Include" offLabel="Skip" />}
                          {r.kind !== "error" ? <p className="mt-1 text-xs text-muted">{r.accepted ? "Included" : "Skipped"}</p> : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {removed.length > 0 ? (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-lg font-medium">No longer in the new list</h2>
                <p className="text-sm text-muted">These designs are in the brand&apos;s current price list but not in this file. They stay active unless you choose to discontinue them.</p>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {removed.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium">
                        {r.payload.row?.brand} · {r.payload.row?.size} · {r.payload.row?.finish}
                      </p>
                      <p className="text-sm text-muted">{r.payload.row?.designs.join(", ")}</p>
                    </div>
                    {reviewing ? (
                      <div className="flex items-center gap-3">
                        <span className="text-sm">{r.accepted ? "Will be discontinued" : "Stay active"}</span>
                        <DecisionForm rowId={r.id} accepted={r.accepted} onLabel="Discontinue" offLabel="Keep active" />
                      </div>
                    ) : (
                      <span className="text-sm text-muted">{r.accepted ? "Discontinued" : "Kept active"}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
