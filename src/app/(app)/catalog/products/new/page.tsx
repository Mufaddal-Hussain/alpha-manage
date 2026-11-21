import Link from "next/link";
import { ProductForm } from "@/components/catalog/product-form";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "New product · alpha-Manage" };

export default async function NewProductPage() {
  await requireUser();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/catalog/products" className="tap text-sm text-muted hover:underline">
          ← Products
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New product</h1>
        <p className="mt-1 text-sm text-muted">Free-text and special items such as granite are fine: leave the packing blank and sell by sq.ft.</p>
      </div>
      <ProductForm product={null} />
    </div>
  );
}
