import Link from "next/link";
import { AddBrandForm, AddDistributorForm, EditBrandForm, EditDistributorForm } from "@/components/catalog/brand-forms";
import { requireUser } from "@/lib/auth/session";
import { listDistributorsWithBrands } from "@/server/catalog-queries";

export const metadata = { title: "Brands · alpha-Manage" };

export default async function BrandsPage() {
  const user = await requireUser();
  const isOwner = user.role === "owner";
  const { distributors, unassigned } = await listDistributorsWithBrands();
  const options = distributors.map((d) => ({ id: d.id, name: d.name }));

  const brandRow = (b: { id: string; name: string; distributorId: string | null; active: boolean; productCount: number }) => (
    <li key={b.id} className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {b.name}
          {!b.active ? <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted">Inactive</span> : null}
        </span>
        <span className="text-sm text-muted">
          {b.productCount} {b.productCount === 1 ? "product" : "products"} ·{" "}
          <Link href="/catalog/price-lists" className="hover:underline">
            price lists
          </Link>
        </span>
      </div>
      {isOwner ? <EditBrandForm brand={b} distributors={options} /> : null}
    </li>
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Brands and distributors</h1>
          <p className="mt-1 text-sm text-muted">A distributor carries one or more brands; each brand has its own versioned price lists.</p>
        </div>
        <Link href="/catalog/import/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
          Import a price list
        </Link>
      </div>

      {distributors.length === 0 && unassigned.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          No brands yet. {isOwner ? "Add a distributor and its brands below, or import a price list and the brands are created for you." : "The owner adds distributors and brands."}
        </p>
      ) : null}

      {distributors.map((d) => (
        <section key={d.id} className="rounded-lg border border-border bg-surface">
          <div className="flex flex-col gap-1 border-b border-border px-4 py-3">
            <h2 className="text-lg font-medium">
              {d.name}
              {!d.active ? <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted">Inactive</span> : null}
            </h2>
            <p className="text-sm text-muted">{[d.phone, d.email, d.gstin ? `GSTIN ${d.gstin}` : null].filter(Boolean).join(" · ") || "No contact details"}</p>
            {isOwner ? <EditDistributorForm distributor={d} /> : null}
          </div>
          {d.brands.length === 0 ? <p className="px-4 py-3 text-sm text-muted">No brands yet.</p> : <ul className="divide-y divide-border">{d.brands.map(brandRow)}</ul>}
        </section>
      ))}

      {unassigned.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border px-4 py-3 text-lg font-medium">No distributor yet</h2>
          <ul className="divide-y divide-border">{unassigned.map(brandRow)}</ul>
        </section>
      ) : null}

      {isOwner ? (
        <div className="grid gap-6 md:grid-cols-2">
          <AddDistributorForm />
          <AddBrandForm distributors={options} />
        </div>
      ) : null}
    </div>
  );
}
