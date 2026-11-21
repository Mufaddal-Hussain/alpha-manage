import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ChallanStatusBadge } from "@/components/challans/challan-status-badge";
import { PoStatusBadge } from "@/components/orders/po-status-badge";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatInr, formatQuantity, formatRupees, UNIT_LABELS } from "@/lib/format";
import { getOrderDelivery } from "@/server/challan-queries";
import { getPurchaseOrder } from "@/server/order-queries";

export const metadata = { title: "Purchase order · alpha-Manage" };

const btn = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60";

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await getPurchaseOrder(id);
  if (!detail) notFound();
  const { lines: delivery, challans } = await getOrderDelivery(id);
  const progress = new Map(delivery.map((d) => [d.poLineId, d]));
  const anyPending = delivery.some((d) => Number(d.pending) > 0);
  const { order, customerName, quotationNumber, revisionNo, lines, notOrdered, files, value, quotedValue } = detail;
  const anyDifference = lines.some((l) => l.quantityQuoted !== null && Number(l.quantityOrdered) !== Number(l.quantityQuoted)) || notOrdered.length > 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <div>
        <Link href="/orders" className="tap text-sm text-muted hover:underline">
          ← Purchase orders
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            PO {order.customerPoNumber}
            <span className="ml-2 text-base font-normal text-muted">from {customerName}</span>
          </h1>
          <PoStatusBadge status={order.status} />
        </div>
        <p className="mt-1 text-sm text-muted">
          Dated {formatDate(order.poDate)} · Against quotation{" "}
          <Link href={`/quotations/${order.quotationId}`} className="font-medium text-foreground hover:underline">
            {quotationNumber}
          </Link>
          {revisionNo > 1 ? ` (revision ${revisionNo})` : ""} ·{" "}
          <Link href={`/customers/${order.customerId}`} className="hover:underline">
            {customerName}
          </Link>
        </p>
      </div>

      <section className="grid gap-6 sm:grid-cols-3" aria-label="Summary">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Advance received</h2>
          <p className="mt-1 text-lg tabular-nums" data-testid="advance-received">{formatRupees(order.advanceReceived)}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Ordered value</h2>
          <p className="mt-1 text-lg tabular-nums" data-testid="ordered-value">{formatRupees(value.total)}</p>
          <p className="text-xs text-muted">
            {formatInr(value.taxable)} + GST {formatInr(value.tax)}, items only
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Quoted value</h2>
          <p className="mt-1 text-lg tabular-nums text-muted">{formatRupees(quotedValue.total)}</p>
          <p className="text-xs text-muted">same items, as quoted</p>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-label="Attachments">
        <h2 className="text-lg font-medium">PO files</h2>
        {files.length === 0 ? (
          <p className="text-sm text-muted">No file was attached to this PO.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <a href={`/api/files/${f.id}`} className="font-medium hover:underline" target="_blank" rel="noreferrer">
                  {f.originalName}
                </a>
                <span className="text-muted">{fileSize(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Ordered items">
        <h2 className="text-lg font-medium">Ordered items</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="stack w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">HSN</th>
                <th className="px-3 py-2 text-right font-medium">Quoted</th>
                <th className="px-3 py-2 text-right font-medium">Ordered</th>
                <th className="px-3 py-2 text-right font-medium">Difference</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Delivered</th>
                <th className="px-3 py-2 text-right font-medium">Pending</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => {
                const delta = l.quantityQuoted === null ? null : Number(l.quantityOrdered) - Number(l.quantityQuoted);
                return (
                  <tr key={l.id} data-testid={`po-line-${l.lineNo}`}>
                    <td data-label="Item" className="px-3 py-2 text-muted">{l.lineNo}</td>
                    <td data-label="Description" className="px-3 py-2">{l.description}</td>
                    <td data-label="HSN" className="px-3 py-2">{l.hsnCode}</td>
                    <td data-label="Quoted" className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      {l.quantityQuoted === null ? "–" : `${formatQuantity(l.quantityQuoted)} ${UNIT_LABELS[l.unit]}`}
                    </td>
                    <td data-label="Ordered" className="px-3 py-2 text-right whitespace-nowrap font-medium tabular-nums">
                      {formatQuantity(l.quantityOrdered)} {UNIT_LABELS[l.unit]}
                    </td>
                    <td data-label="Difference" className="px-3 py-2 text-right whitespace-nowrap tabular-nums" data-testid={`po-difference-${l.lineNo}`}>
                      {delta === null ? "not on quotation" : delta === 0 ? "same" : `${delta > 0 ? "+" : "−"}${formatQuantity(Math.abs(delta))}`}
                    </td>
                    <td data-label="Rate" className="px-3 py-2 text-right tabular-nums">
                      {formatInr(l.rate)}
                      {Number(l.discountPercent) > 0 ? <span className="block text-xs text-muted">{formatQuantity(l.discountPercent)}% off</span> : null}
                    </td>
                    <td data-label="Delivered" className="px-3 py-2 text-right whitespace-nowrap tabular-nums" data-testid={`po-delivered-${l.lineNo}`}>
                      {formatQuantity(progress.get(l.id)?.delivered ?? 0)} {UNIT_LABELS[l.unit]}
                    </td>
                    <td data-label="Pending" className="px-3 py-2 text-right whitespace-nowrap font-medium tabular-nums" data-testid={`po-pending-${l.lineNo}`}>
                      {formatQuantity(progress.get(l.id)?.pending ?? 0)} {UNIT_LABELS[l.unit]}
                      {Number(progress.get(l.id)?.excess ?? 0) > 0 ? (
                        <span className="block text-xs font-normal text-accent">{formatQuantity(progress.get(l.id)!.excess)} over-delivered (owner override)</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {notOrdered.map((l) => (
                <tr key={l.id} className="text-muted" data-testid="po-not-ordered">
                  <td data-label="Item" className="px-3 py-2">–</td>
                  <td data-label="Description" className="px-3 py-2 line-through">{l.description}</td>
                  <td data-label="HSN" className="px-3 py-2">{l.hsnCode}</td>
                  <td data-label="Quoted" className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {formatQuantity(l.quantity)} {UNIT_LABELS[l.unit]}
                  </td>
                  <td data-label="Ordered" className="px-3 py-2 text-right">0</td>
                  <td data-label="Difference" className="px-3 py-2 text-right whitespace-nowrap">not ordered</td>
                  <td data-label="Rate" className="px-3 py-2 text-right tabular-nums">{formatInr(l.rate)}</td>
                  <td data-label="Delivered" className="px-3 py-2 text-right">–</td>
                  <td data-label="Pending" className="px-3 py-2 text-right">–</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {anyDifference ? (
          <p className="text-sm text-muted">This PO differs from the quotation: struck-through items were quoted but not ordered.</p>
        ) : (
          <p className="text-sm text-muted">This PO matches the quotation.</p>
        )}
        <p className="text-xs text-muted">Delivered is the total on issued challans; a cancelled challan no longer counts, so its quantities are pending again.</p>
      </section>

      <section className="flex flex-col gap-3" aria-label="Challans">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Delivery challans</h2>
          {order.status !== "cancelled" && (anyPending || user.role === "owner") ? (
            <Link href={`/challans/new?order=${order.id}`} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">
              New challan
            </Link>
          ) : null}
        </div>
        {challans.length === 0 ? (
          <p className="text-sm text-muted">No challan has been issued against this PO yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {challans.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2" data-testid="po-challan">
                <span>
                  <Link href={`/challans/${c.id}`} className="font-medium hover:underline">
                    {c.number}
                  </Link>
                  <span className="ml-2 text-muted">
                    {formatDate(c.challanDate)}
                    {c.vehicleNo ? ` · ${c.vehicleNo}` : ""}
                  </span>
                </span>
                <ChallanStatusBadge status={c.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {order.notes ? (
        <section aria-label="Notes">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Notes</h2>
          <p className="mt-1 text-sm whitespace-pre-line">{order.notes}</p>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link href={`/quotations/${order.quotationId}`} className={btn}>
          View quotation
        </Link>
      </div>
    </div>
  );
}
