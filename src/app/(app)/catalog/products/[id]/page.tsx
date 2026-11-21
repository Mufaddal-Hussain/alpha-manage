import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProductForm } from "@/components/catalog/product-form";
import { requireUser } from "@/lib/auth/session";
import { getProduct } from "@/server/product-queries";
import { setProductStatus } from "@/server/products";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const UNIT_LABEL = { box: "box", sqft: "sq.ft", piece: "piece" } as const;

export const metadata = { title: "Product · alpha-Manage" };

export default async function ProductPage({ params }: PageProps<"/catalog/products/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const product = await getProduct(id);
  if (!product) notFound();
  const discontinued = product.status === "discontinued";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/catalog/products" className="tap text-sm text-muted hover:underline">
          ← Products
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {product.name}
            {discontinued ? <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted">Discontinued</span> : null}
          </h1>
          {user.role === "owner" ? (
            <form action={setProductStatus}>
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="status" value={discontinued ? "active" : "discontinued"} />
              <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60">
                {discontinued ? "Mark active" : "Discontinue"}
              </button>
            </form>
          ) : null}
        </div>
        {discontinued ? <p className="mt-1 text-sm text-muted">Discontinued products stay on old quotations but cannot be added to new ones.</p> : null}
      </div>
      {product.costReviewNeeded ? (
        <div role="status" className="rounded-md border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-400">Cost changed, review selling price</p>
          <p className="mt-1 text-muted">
            The latest price list changed this product&apos;s cost
            {product.previousCostPerUnit ? ` from ${inr.format(Number(product.previousCostPerUnit))}` : ""} to {product.costPerUnit ? inr.format(Number(product.costPerUnit)) : "—"} per {UNIT_LABEL[product.unit]}. The
            selling price was not changed. Saving the selling price below clears this flag.
          </p>
        </div>
      ) : null}
      {product.costPerUnit || product.brandName ? (
        <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2">
          {product.brandName ? (
            <div>
              <dt className="text-muted">Brand</dt>
              <dd className="font-medium">{product.brandName}</dd>
            </div>
          ) : null}
          {product.costPerUnit ? (
            <div>
              <dt className="text-muted">Cost price (ex-GST)</dt>
              <dd className="font-medium">
                {inr.format(Number(product.costPerUnit))} per {UNIT_LABEL[product.unit]}
              </dd>
            </div>
          ) : null}
          {product.marginPercent ? (
            <div>
              <dt className="text-muted">Margin on cost</dt>
              <dd className="font-medium">{Number(product.marginPercent)}%</dd>
            </div>
          ) : null}
          {product.priceListId ? (
            <div>
              <dt className="text-muted">Cost comes from</dt>
              <dd>
                <Link href={`/catalog/price-lists/${product.priceListId}`} className="text-accent hover:underline">
                  {product.brandName} {product.priceListLabel ?? product.priceListEffectiveFrom}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <ProductForm product={product} salesOnly={user.role !== "owner"} />
    </div>
  );
}
