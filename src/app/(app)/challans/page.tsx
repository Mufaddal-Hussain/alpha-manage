import Link from "next/link";
import { ChallanStatusBadge } from "@/components/challans/challan-status-badge";
import type { ChallanStatus } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { listChallans } from "@/server/challan-queries";

export const metadata = { title: "Challans · alpha-Manage" };

const STATUSES: ChallanStatus[] = ["issued", "cancelled"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const field = "rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function ChallansPage({ searchParams }: PageProps<"/challans">) {
  await requireUser();
  const params = await searchParams;
  const customer = one(params.customer);
  const number = one(params.number);
  const poNumber = one(params.po);
  const status = STATUSES.find((s) => s === one(params.status));
  const from = ISO_DATE.test(one(params.from)) ? one(params.from) : "";
  const to = ISO_DATE.test(one(params.to)) ? one(params.to) : "";
  const rows = await listChallans({ customer, number, poNumber, status, from: from || undefined, to: to || undefined });
  const filtered = Boolean(customer || number || poNumber || status || from || to);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Delivery challans</h1>
          <p className="mt-1 text-sm text-muted">Dispatches against customer POs. Find one by customer, challan number, PO number or date.</p>
        </div>
        <Link href="/challans/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
          New challan
        </Link>
      </div>

      <form method="get" action="/challans" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <input type="search" name="customer" defaultValue={customer} placeholder="Customer" aria-label="Customer" className={`${field} lg:col-span-2`} />
        <input type="search" name="number" defaultValue={number} placeholder="Challan no." aria-label="Challan number" className={`${field} lg:col-span-2`} />
        <input type="search" name="po" defaultValue={poNumber} placeholder="Customer PO number" aria-label="Customer PO number" className={field} />
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className={field}>
          <option value="">Any status</option>
          <option value="issued">Issued</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-6">
          <label className="flex items-center gap-2 text-sm text-muted">
            From
            <input type="date" name="from" defaultValue={from} aria-label="From date" className={field} />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            To
            <input type="date" name="to" defaultValue={to} aria-label="To date" className={field} />
          </label>
          <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-border/60">
            Search
          </button>
          {filtered ? (
            <Link href="/challans" className="self-center text-sm text-muted hover:underline">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          {filtered ? "No challans match these filters." : "No challans yet. Issue one against a purchase order."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Challan</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Customer PO</th>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-border/40">
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    <Link href={`/challans/${c.id}`} className="hover:underline">
                      {c.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(c.challanDate)}</td>
                  <td className="px-4 py-3">{c.customerName}</td>
                  <td className="px-4 py-3">
                    <Link href={`/orders/${c.purchaseOrderId}`} className="hover:underline">
                      {c.customerPoNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{c.vehicleNo || "–"}</td>
                  <td className="px-4 py-3">
                    <ChallanStatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
