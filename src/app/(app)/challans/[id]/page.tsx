import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CancelChallanForm } from "@/components/challans/cancel-challan-form";
import { ChallanStatusBadge } from "@/components/challans/challan-status-badge";
import { cancelRefusal } from "@/lib/challan/permissions";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatInr, formatQuantity, UNIT_LABELS } from "@/lib/format";
import { getStateByCode } from "@/lib/gst/state-codes";
import { istDate } from "@/lib/quotation/status";
import { getChallan } from "@/server/challan-queries";

export const metadata = { title: "Challan · alpha-Manage" };

const btn = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60";
const stateName = (code: string) => `${getStateByCode(code)?.name ?? code} (${code})`;

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

export default async function ChallanPage({ params }: PageProps<"/challans/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await getChallan(id);
  if (!detail) notFound();
  const { challan: c, customerName, customerPoNumber, quotationId, quotationNumber, lines, createdByName, cancelledByName } = detail;
  const cancelled = c.status === "cancelled";
  const refusal = cancelRefusal(user.role, user.id, c, new Date());
  const pdf = `/api/documents/challan/${c.id}/pdf`;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <div>
        <Link href="/challans" className="text-sm text-muted hover:underline">
          ← Challans
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Challan {c.number}
            <span className="ml-2 text-base font-normal text-muted">to {customerName}</span>
          </h1>
          <ChallanStatusBadge status={c.status} />
        </div>
        <p className="mt-1 text-sm text-muted">
          Dated {formatDate(c.challanDate)} · Against{" "}
          <Link href={`/orders/${c.purchaseOrderId}`} className="font-medium text-foreground hover:underline">
            PO {customerPoNumber}
          </Link>{" "}
          · Quotation{" "}
          <Link href={`/quotations/${quotationId}`} className="hover:underline">
            {quotationNumber}
          </Link>
          {createdByName ? ` · Issued by ${createdByName}` : ""}
        </p>
      </div>

      {cancelled ? (
        <section role="status" data-testid="challan-cancelled" className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger" aria-label="Cancelled">
          <p className="font-medium">This challan was cancelled{c.cancelledAt ? ` on ${formatDate(istDate(c.cancelledAt))}` : ""}{cancelledByName ? ` by ${cancelledByName}` : ""}.</p>
          <p className="mt-1">Reason: {c.cancelReason}</p>
          <p className="mt-1 text-xs">Its number {c.number} stays reserved and is not reused. The quantities below count as pending again on the PO.</p>
        </section>
      ) : null}

      <section className="flex flex-wrap gap-2" aria-label="PDF">
        <a href={`${pdf}?prices=hide`} target="_blank" rel="noreferrer" className={btn}>
          PDF without prices
        </a>
        <a href={`${pdf}?prices=show`} target="_blank" rel="noreferrer" className={btn}>
          PDF with prices
        </a>
        <a href={`${pdf}?prices=${c.showPrices ? "show" : "hide"}&download=1`} className={btn}>
          Download
        </a>
      </section>

      <section className="grid gap-6 sm:grid-cols-2" aria-label="Parties">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Consignee (ship to)</h2>
          <p className="mt-1 font-medium">{c.consigneeName}</p>
          {c.consigneeAddress ? <p className="text-sm whitespace-pre-line">{c.consigneeAddress}</p> : null}
          {c.consigneeGstin ? <p className="text-sm">GSTIN {c.consigneeGstin}</p> : null}
          <p className="text-sm text-muted">{stateName(c.consigneeStateCode)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Buyer (bill to)</h2>
          <p className="mt-1 font-medium">{c.buyerName}</p>
          {c.buyerAddress ? <p className="text-sm whitespace-pre-line">{c.buyerAddress}</p> : null}
          {c.buyerGstin ? <p className="text-sm">GSTIN {c.buyerGstin}</p> : null}
          <p className="text-sm text-muted">{stateName(c.buyerStateCode)}</p>
        </div>
      </section>

      <section aria-label="Dispatch details">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Vehicle no." value={c.vehicleNo} />
          <Detail label="Driver" value={[c.driverName, c.driverPhone].filter(Boolean).join(", ") || null} />
          <Detail label="Dispatched through" value={c.dispatchedThrough} />
          <Detail label="Destination" value={c.destination} />
          <Detail label="Mode/terms of payment" value={c.modeTermsOfPayment} />
          <Detail label="Terms of delivery" value={c.termsOfDelivery} />
          <Detail label="Reference no. & date" value={c.referenceNoDate} />
          <Detail label="Buyer's order no. & date" value={c.buyersOrderNoDate} />
          <Detail label="Dispatch doc no." value={c.dispatchDocNo} />
          <Detail label="Other references" value={c.otherReferences} />
          <Detail label="Prices on this challan" value={c.showPrices ? "Shown by default" : "Hidden by default"} />
          <Detail label="Override" value={c.overrideReason ? `More than pending was delivered: ${c.overrideReason}` : null} />
        </dl>
      </section>

      <section className="flex flex-col gap-3" aria-label="Delivered items">
        <h2 className="text-lg font-medium">Delivered items</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">HSN</th>
                <th className="px-3 py-2 text-right font-medium">Quantity</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.id} data-testid={`challan-line-${l.lineNo}`}>
                  <td className="px-3 py-2 text-muted">{l.lineNo}</td>
                  <td className="px-3 py-2">{l.description}</td>
                  <td className="px-3 py-2">{l.hsnCode}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-medium tabular-nums">
                    {formatQuantity(l.quantity)} {UNIT_LABELS[l.unit]}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatInr(l.rate)}
                    {Number(l.discountPercent) > 0 ? <span className="block text-xs text-muted">{formatQuantity(l.discountPercent)}% off</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {!cancelled ? (
        <section className="flex flex-col gap-2 border-t border-border pt-6" aria-label="Cancel">
          <h2 className="text-lg font-medium">Cancel this challan</h2>
          {refusal ? (
            <p data-testid="cancel-blocked" className="text-sm text-muted">
              {refusal}.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">The challan is kept with its number and marked cancelled; what it delivered becomes pending again on the PO.</p>
              <CancelChallanForm id={c.id} number={c.number} />
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
