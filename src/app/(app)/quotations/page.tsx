import Link from "next/link";
import { StatusBadge } from "@/components/quotations/status-badge";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatRupees } from "@/lib/format";
import { STATUS_LABELS, type DisplayStatus } from "@/lib/quotation/status";
import { listQuotations } from "@/server/quotation-queries";

export const metadata = { title: "Quotations · alpha-Manage" };

const STATUSES = Object.keys(STATUS_LABELS) as DisplayStatus[];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const field = "rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function QuotationsPage({ searchParams }: PageProps<"/quotations">) {
  await requireUser();
  const params = await searchParams;
  const customer = one(params.customer);
  const number = one(params.number);
  const status = STATUSES.find((s) => s === one(params.status));
  const from = ISO_DATE.test(one(params.from)) ? one(params.from) : "";
  const to = ISO_DATE.test(one(params.to)) ? one(params.to) : "";
  const rows = await listQuotations({ customer, number, status, from: from || undefined, to: to || undefined });
  const filtered = Boolean(customer || number || status || from || to);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quotations</h1>
          <p className="mt-1 text-sm text-muted">Find a quotation by customer, number, status or date.</p>
        </div>
        <Link href="/quotations/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
          New quotation
        </Link>
      </div>

      <form method="get" action="/quotations" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <input type="search" name="customer" defaultValue={customer} placeholder="Customer" aria-label="Customer" className={`${field} lg:col-span-2`} />
        <input type="search" name="number" defaultValue={number} placeholder="Number, e.g. QT/2026-27/0001" aria-label="Quotation number" className={`${field} lg:col-span-2`} />
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className={field}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
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
            <Link href="/quotations" className="tap self-center text-sm text-muted hover:underline">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          {filtered ? "No quotations match these filters." : "No quotations yet. Create the first one."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="stack w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Valid until</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((q) => (
                <tr key={q.id} className="hover:bg-border/40">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/quotations/${q.id}`} className="hover:underline">
                      {q.number ?? "Draft"}
                    </Link>
                    {q.revisionNo > 1 ? <span className="ml-1 text-xs font-normal text-muted">rev {q.revisionNo}</span> : null}
                  </td>
                  <td data-label="Customer" className="px-4 py-3">{q.customerName}</td>
                  <td data-label="Date" className="px-4 py-3 whitespace-nowrap">{formatDate(q.quotationDate)}</td>
                  <td data-label="Valid until" className="px-4 py-3 whitespace-nowrap">{formatDate(q.validUntil)}</td>
                  <td data-label="Total" className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{formatRupees(q.grandTotal)}</td>
                  <td data-label="Status" className="px-4 py-3">
                    <StatusBadge status={q.displayStatus} />
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
