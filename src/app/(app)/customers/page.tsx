import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getStateByCode } from "@/lib/gst/state-codes";
import { searchCustomers } from "@/server/customer-queries";

export const metadata = { title: "Customers · alpha-Manage" };

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const includeInactive = params.inactive === "1";
  const customers = await searchCustomers(q, { includeInactive });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm text-muted">Search by name, GSTIN or phone number.</p>
        </div>
        <Link href="/customers/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
          New customer
        </Link>
      </div>

      <form method="get" action="/customers" role="search" className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Name, GSTIN or phone"
          aria-label="Search customers"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="inactive" value="1" defaultChecked={includeInactive} /> Include inactive
        </label>
        <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-border/60">
          Search
        </button>
      </form>

      {customers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          {q ? `No customers match “${q}”.` : "No customers yet. Add the first one."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {customers.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-border/40">
                <span className="font-medium">
                  {c.displayName}
                  {!c.active ? <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted">Inactive</span> : null}
                </span>
                <span className="text-sm text-muted">
                  <span className="capitalize">{c.type}</span>
                  {" · "}
                  {getStateByCode(c.stateCode)?.name ?? c.stateCode}
                  {c.gstin ? ` · ${c.gstin}` : ""}
                  {c.phone ? ` · ${c.phone}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
