import Link from "next/link";
import { PoStatusBadge } from "@/components/orders/po-status-badge";
import type { PurchaseOrderStatus } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatRupees } from "@/lib/format";
import { PO_STATUS_LABELS } from "@/lib/order/labels";
import { listPurchaseOrders } from "@/server/order-queries";

export const metadata = { title: "Purchase orders · alpha-Manage" };

const STATUSES = Object.keys(PO_STATUS_LABELS) as PurchaseOrderStatus[];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const field = "rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  await requireUser();
  const params = await searchParams;
  const customer = one(params.customer);
  const poNumber = one(params.po);
  const quotationNumber = one(params.quotation);
  const status = STATUSES.find((s) => s === one(params.status));
  const from = ISO_DATE.test(one(params.from)) ? one(params.from) : "";
  const to = ISO_DATE.test(one(params.to)) ? one(params.to) : "";
  const rows = await listPurchaseOrders({ customer, poNumber, quotationNumber, status, from: from || undefined, to: to || undefined });
  const filtered = Boolean(customer || poNumber || quotationNumber || status || from || to);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase orders</h1>
          <p className="mt-1 text-sm text-muted">The customers&apos; POs recorded against approved quotations. Find one by customer, PO number or date.</p>
        </div>
        <Link href="/orders/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
          Record PO
        </Link>
      </div>

      <form method="get" action="/orders" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <input type="search" name="customer" defaultValue={customer} placeholder="Customer" aria-label="Customer" className={`${field} lg:col-span-2`} />
        <input type="search" name="po" defaultValue={poNumber} placeholder="Customer PO number" aria-label="Customer PO number" className={`${field} lg:col-span-2`} />
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className={field}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {PO_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <input type="search" name="quotation" defaultValue={quotationNumber} placeholder="Quotation no." aria-label="Quotation number" className={field} />
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-6">
          <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-sm text-muted sm:flex-none">
            From
            <input type="date" name="from" defaultValue={from} aria-label="From date" className={`${field} min-w-0 flex-1`} />
          </label>
          <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-sm text-muted sm:flex-none">
            To
            <input type="date" name="to" defaultValue={to} aria-label="To date" className={`${field} min-w-0 flex-1`} />
          </label>
          <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-border/60">
            Search
          </button>
          {filtered ? (
            <Link href="/orders" className="tap self-center text-sm text-muted hover:underline">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          {filtered ? "No purchase orders match these filters." : "No purchase orders yet. Record one against an approved quotation."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="stack w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Customer PO</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">PO date</th>
                <th className="px-4 py-2 font-medium">Quotation</th>
                <th className="px-4 py-2 text-right font-medium">Advance</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-border/40">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/orders/${o.id}`} className="hover:underline">
                      {o.customerPoNumber}
                    </Link>
                  </td>
                  <td data-label="Customer" className="px-4 py-3">{o.customerName}</td>
                  <td data-label="PO date" className="px-4 py-3 whitespace-nowrap">{formatDate(o.poDate)}</td>
                  <td data-label="Quotation" className="px-4 py-3 whitespace-nowrap">
                    <Link href={`/quotations/${o.quotationId}`} className="hover:underline">
                      {o.quotationNumber}
                    </Link>
                  </td>
                  <td data-label="Advance" className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{Number(o.advanceReceived) > 0 ? formatRupees(o.advanceReceived) : "–"}</td>
                  <td data-label="Status" className="px-4 py-3">
                    <PoStatusBadge status={o.status} />
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
