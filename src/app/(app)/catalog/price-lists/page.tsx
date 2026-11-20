import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listPriceLists } from "@/server/catalog-queries";

export const metadata = { title: "Price lists · alpha-Manage" };

const STATUS = {
  published: { label: "Current", style: "border-success/50 bg-success/10 text-success" },
  superseded: { label: "Superseded", style: "border-border text-muted" },
  draft: { label: "Draft", style: "border-border text-muted" },
} as const;

export default async function PriceListsPage() {
  await requireUser();
  const lists = await listPriceLists();
  const brands = [...new Set(lists.map((l) => l.brandName))];
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Price lists</h1>
          <p className="mt-1 text-sm text-muted">Every version of each brand&apos;s distributor price list. The latest approved one is current; earlier ones stay readable.</p>
        </div>
        <Link href="/catalog/import/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
          Import a price list
        </Link>
      </div>

      {lists.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">No price lists yet. Import the first one from the template.</p>
      ) : (
        brands.map((brandName) => (
          <section key={brandName}>
            <h2 className="mb-2 text-lg font-medium">{brandName}</h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {lists
                .filter((l) => l.brandName === brandName)
                .map((l) => (
                  <li key={l.id}>
                    <Link href={`/catalog/price-lists/${l.id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-border/40">
                      <span className="font-medium">
                        {l.label ? `${l.label} · ` : ""}w.e.f. {l.effectiveFrom}
                        <span className={`ml-2 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS[l.status].style}`}>{STATUS[l.status].label}</span>
                      </span>
                      <span className="text-sm text-muted">
                        {l.groupCount} groups · {l.designCount} designs{l.referenceFileId ? " · reference PDF attached" : ""}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
