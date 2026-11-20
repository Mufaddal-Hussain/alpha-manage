import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProductForm } from "@/components/catalog/product-form";
import { requireUser } from "@/lib/auth/session";
import { getProduct } from "@/server/product-queries";
import { setProductStatus } from "@/server/products";

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
        <Link href="/catalog/products" className="text-sm text-muted hover:underline">
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
      <ProductForm product={product} salesOnly={user.role !== "owner"} />
    </div>
  );
}
