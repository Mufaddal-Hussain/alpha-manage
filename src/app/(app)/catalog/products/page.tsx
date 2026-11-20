import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { searchProducts } from "@/server/product-queries";

export const metadata = { title: "Products · alpha-Manage" };

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const UNIT_LABEL = { box: "box", sqft: "sq.ft", piece: "piece" } as const;

export default async function ProductsPage({ searchParams }: PageProps<"/catalog/products">) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const includeDiscontinued = params.discontinued === "1";
  const products = await searchProducts(q, { includeDiscontinued });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted">Tiles, granite and special items you quote. Search by name, code, size or finish.</p>
        </div>
        <Link href="/catalog/products/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
          New product
        </Link>
      </div>

      <form method="get" action="/catalog/products" role="search" className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Name, code, size or finish"
          aria-label="Search products"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="discontinued" value="1" defaultChecked={includeDiscontinued} /> Include discontinued
        </label>
        <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-border/60">
          Search
        </button>
      </form>

      {products.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          {q ? `No products match “${q}”.` : "No products yet. Add the first one."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {products.map((p) => (
            <li key={p.id}>
              <Link href={`/catalog/products/${p.id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-border/40">
                <span className="font-medium">
                  {p.name}
                  {p.status === "discontinued" ? (
                    <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted">Discontinued</span>
                  ) : null}
                </span>
                <span className="text-sm text-muted">
                  {[p.sizeLabel, p.finish].filter(Boolean).join(" · ")}
                  {p.sizeLabel || p.finish ? " · " : ""}
                  HSN {p.hsnCode} · GST {Number(p.gstRate)}%
                  {p.sellingPricePerUnit ? ` · ${inr.format(Number(p.sellingPricePerUnit))} / ${UNIT_LABEL[p.unit]}` : " · no price set"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
