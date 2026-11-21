import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CopyLinkButton } from "@/components/quotations/copy-link-button";
import { StatusActions } from "@/components/quotations/status-actions";
import { StatusBadge } from "@/components/quotations/status-badge";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatInr, formatQuantity, UNIT_LABELS } from "@/lib/format";
import { getStateByCode } from "@/lib/gst/state-codes";
import { PoStatusBadge } from "@/components/orders/po-status-badge";
import { allowedActions, canRecordPurchaseOrder, effectiveStatus, purchaseOrderRefusal } from "@/lib/quotation/status";
import { getQuotationPurchaseOrders } from "@/server/order-queries";
import { getQuotation } from "@/server/quotation-queries";

export const metadata = { title: "Quotation · alpha-Manage" };

const btn = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60";
const stateName = (code: string | null) => (code ? (getStateByCode(code)?.name ?? code) : "");

export default async function QuotationPage({ params, searchParams }: PageProps<"/quotations/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const asked = typeof query.revision === "string" && /^\d+$/.test(query.revision) ? Number(query.revision) : undefined;

  const [detail, orders] = await Promise.all([getQuotation(id, asked), getQuotationPurchaseOrders(id)]);
  if (!detail) notFound();
  const { quotation, customerName, current, revisions, lines } = detail;
  const latest = revisions[0];
  const viewingLatest = current.id === latest.id;
  const view = effectiveStatus(quotation.status, latest.validUntil, new Date());
  const actions = allowedActions(view, quotation.number !== null);
  const issued = current.issuedAt !== null;
  const pdfBase = `/api/documents/quotation/${id}/pdf?revision=${current.revisionNo}`;
  const previewSuffix = issued ? "" : "&preview=1";
  const intra = current.taxMode === "intra";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <div>
        <Link href="/quotations" className="text-sm text-muted hover:underline">
          ← Quotations
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {quotation.number ?? "Draft quotation"}
            {current.revisionNo > 1 ? <span className="ml-2 text-base font-normal text-muted">revision {current.revisionNo}</span> : null}
          </h1>
          <StatusBadge status={viewingLatest ? view : quotation.status === "draft" ? "draft" : "sent"} />
        </div>
        <p className="mt-1 text-sm text-muted">
          <Link href={`/customers/${quotation.customerId}`} className="hover:underline">
            {customerName}
          </Link>
          {" · "}Dated {formatDate(current.quotationDate)} · Valid until {formatDate(current.validUntil)}
          {view === "expired" && viewingLatest ? <span className="font-medium text-danger"> (expired)</span> : null}
        </p>
        {!viewingLatest ? (
          <p className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-sm">
            You are looking at revision {current.revisionNo}, which has been replaced.{" "}
            <Link href={`/quotations/${id}`} className="font-medium underline">
              Go to the latest (revision {latest.revisionNo})
            </Link>
          </p>
        ) : null}
      </div>

      {viewingLatest ? (
        <section className="flex flex-col gap-4" aria-label="Actions">
          {quotation.status === "draft" ? (
            <div className="flex flex-wrap gap-2">
              <Link href={`/quotations/${id}/revise`} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">
                {quotation.number ? "Continue editing revision" : "Continue editing"}
              </Link>
            </div>
          ) : null}
          <StatusActions id={id} actions={actions} hasNumber={quotation.number !== null} currentValidUntil={latest.validUntil} expired={view === "expired"} />
          {quotation.status === "approved" ? (
            <p className="text-sm text-muted">Approved quotations are locked. Duplicate it to quote something similar.</p>
          ) : null}
        </section>
      ) : null}

      {viewingLatest && (quotation.number !== null && quotation.status !== "draft") ? (
        <section className="flex flex-col gap-3" aria-label="Purchase orders">
          <h2 className="text-lg font-medium">Purchase orders</h2>
          {canRecordPurchaseOrder(view) ? (
            <div>
              <Link href={`/orders/new?quotation=${id}`} className="inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">
                Record PO
              </Link>
            </div>
          ) : (
            <div>
              <button type="button" disabled aria-describedby="po-blocked-reason" className="cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-muted opacity-60">
                Record PO
              </button>
              <p id="po-blocked-reason" data-testid="po-blocked-reason" className="mt-2 text-sm text-muted">
                {purchaseOrderRefusal(view)}.
              </p>
            </div>
          )}
          {orders.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span>
                    <Link href={`/orders/${o.id}`} className="font-medium hover:underline">
                      PO {o.customerPoNumber}
                    </Link>
                    <span className="ml-2 text-muted">{formatDate(o.poDate)}</span>
                  </span>
                  <PoStatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3" aria-label="PDF">
        <h2 className="text-lg font-medium">PDF</h2>
        <div className="flex flex-wrap gap-2">
          <a className={btn} href={`${pdfBase}${previewSuffix}`} target="_blank" rel="noreferrer">
            View PDF ({current.layout === "estimate" ? "estimate" : "GST quotation"})
          </a>
          <a className={btn} href={`${pdfBase}&download=1${previewSuffix}`}>
            Download PDF
          </a>
          <a className={btn} href={`${pdfBase}&layout=${current.layout === "estimate" ? "gst_quotation" : "estimate"}&download=1${previewSuffix}`}>
            Download as {current.layout === "estimate" ? "GST quotation" : "estimate"}
          </a>
          {issued ? <CopyLinkButton path={`${pdfBase}`} /> : null}
        </div>
        {!issued ? <p className="text-xs text-muted">This is a draft: the PDF is watermarked and has no number until the quotation is issued.</p> : null}
        {issued ? <p className="text-xs text-muted">The PDF link only opens for signed-in staff; download the PDF to send it to the customer.</p> : null}
      </section>

      <section className="grid gap-6 md:grid-cols-2" aria-label="Parties">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Bill to</h2>
          <p className="mt-1 font-medium">{current.billToName}</p>
          {current.billToAddress ? <p className="text-sm whitespace-pre-line">{current.billToAddress}</p> : null}
          <p className="text-sm text-muted">
            {current.billToGstin ? `GSTIN ${current.billToGstin} · ` : ""}
            {stateName(current.billToStateCode)} ({current.billToStateCode})
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Ship to / site</h2>
          <p className="mt-1 text-sm whitespace-pre-line">{current.shipToAddress ?? current.billToAddress ?? "Same as bill-to"}</p>
          <p className="text-sm text-muted">
            {stateName(current.placeOfSupplyStateCode)} ({current.placeOfSupplyStateCode})
            {current.siteContactName ? ` · ${current.siteContactName}` : ""}
            {current.siteContactPhone ? ` ${current.siteContactPhone}` : ""}
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-label="Items">
        <h2 className="text-lg font-medium">Items</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">HSN/SAC</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Disc %</th>
                <th className="px-3 py-2 text-right font-medium">Taxable</th>
                <th className="px-3 py-2 text-right font-medium">GST %</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-muted">{l.lineNo}</td>
                  <td className="px-3 py-2">{l.description}</td>
                  <td className="px-3 py-2">{l.hsnCode}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {l.kind === "charge" ? "–" : `${formatQuantity(l.quantity)} ${UNIT_LABELS[l.unit]}`}
                    {l.kind === "product" && l.quantityAlt && l.unit !== "piece" ? (
                      <span className="block text-xs text-muted">
                        {formatQuantity(l.quantityAlt)} {l.unit === "box" ? "sq.ft" : "box"}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(l.rate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.kind === "charge" ? "" : formatQuantity(l.discountPercent)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(l.taxableValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(l.gstRate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto flex w-full max-w-sm flex-col gap-1 text-sm">
          <Row label="Taxable value" value={current.subtotal} />
          {intra ? (
            <>
              <Row label="CGST" value={current.cgstTotal} />
              <Row label="SGST" value={current.sgstTotal} />
            </>
          ) : (
            <Row label="IGST" value={current.igstTotal} />
          )}
          <Row label="Round off" value={current.roundOff} signed />
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>Grand total</dt>
            <dd className="tabular-nums">₹ {formatInr(current.grandTotal)}</dd>
          </div>
          <p className="text-right text-xs text-muted">{current.totalInWords}</p>
          {Number(current.advanceAmount) > 0 ? (
            <>
              <Row label="Advance" value={current.advanceAmount} />
              <Row label="Balance" value={(Number(current.grandTotal) - Number(current.advanceAmount)).toFixed(2)} />
            </>
          ) : null}
        </dl>
      </section>

      {current.notes ? (
        <section aria-label="Notes">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Notes</h2>
          <p className="mt-1 text-sm whitespace-pre-line">{current.notes}</p>
        </section>
      ) : null}
      {current.termsText ? (
        <section aria-label="Terms">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Terms and conditions</h2>
          <p className="mt-1 text-sm whitespace-pre-line">{current.termsText}</p>
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-label="Revision history">
        <h2 className="text-lg font-medium">Revisions</h2>
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
          {revisions.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>
                <Link href={r.id === latest.id ? `/quotations/${id}` : `/quotations/${id}?revision=${r.revisionNo}`} className={`font-medium hover:underline ${r.id === current.id ? "text-accent" : ""}`}>
                  Revision {r.revisionNo}
                </Link>
                {r.id === latest.id ? <span className="ml-2 text-xs text-muted">latest</span> : null}
                {r.issuedAt === null ? <span className="ml-2 text-xs text-muted">draft</span> : null}
              </span>
              <span className="text-muted">
                {formatDate(r.quotationDate)} · ₹ {formatInr(r.grandTotal)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Row({ label, value, signed = false }: { label: string; value: string; signed?: boolean }) {
  const shown = signed && Number(value) > 0 ? `+${formatInr(value)}` : formatInr(value);
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">₹ {shown}</dd>
    </div>
  );
}
