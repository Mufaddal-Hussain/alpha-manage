import Link from "next/link";
import { ImportForm } from "@/components/catalog/import-form";
import { requireUser } from "@/lib/auth/session";
import { listBrandOptions, listRecentImportJobs } from "@/server/catalog-queries";

export const metadata = { title: "Import a price list · alpha-Manage" };

const STATUS_LABEL = { uploaded: "Uploaded", processing: "Processing", needs_review: "Needs review", approved: "Approved", failed: "Could not read" } as const;

export default async function NewImportPage() {
  await requireUser();
  const [brands, jobs] = await Promise.all([listBrandOptions(), listRecentImportJobs()]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/catalog/brands" className="text-sm text-muted hover:underline">
          ← Brands
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Import a price list</h1>
        <p className="mt-1 text-sm text-muted">
          Type or paste the distributor&apos;s price list into the template, one row per price of a group (all designs that share a price go in one cell, separated by semicolons).
          You review the result before anything is saved.
        </p>
        <p className="mt-3">
          <a href="/api/imports/template" className="text-sm font-medium text-accent hover:underline">
            Download the template (.xlsx)
          </a>
        </p>
      </div>

      <ImportForm brands={brands.filter((b) => b.active)} />

      {jobs.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-medium">Recent imports</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/catalog/import/${j.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-border/40">
                  <span className="font-medium">{j.sourceName}</span>
                  <span className="text-sm text-muted">
                    {STATUS_LABEL[j.status]} · {j.rowCount} rows · {j.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
