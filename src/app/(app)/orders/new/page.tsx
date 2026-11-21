import Link from "next/link";
import { PoForm } from "@/components/orders/po-form";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatRupees } from "@/lib/format";
import { canRecordPurchaseOrder, istDate, purchaseOrderRefusal } from "@/lib/quotation/status";
import { getApprovedQuotations, getPurchaseOrderForm } from "@/server/order-queries";
import { z } from "zod";

export const metadata = { title: "Record PO · alpha-Manage" };

const btn = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60";

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  await requireUser();
  const query = await searchParams;
  const asked = typeof query.quotation === "string" && z.uuid().safeParse(query.quotation).success ? query.quotation : null;

  const header = (
    <div>
      <Link href="/orders" className="tap text-sm text-muted hover:underline">
        ← Purchase orders
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Record customer PO</h1>
    </div>
  );

  const data = asked ? await getPurchaseOrderForm(asked) : null;

  // No quotation chosen yet (or an unknown one): pick from the approved ones.
  if (!data) {
    const approved = await getApprovedQuotations();
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {header}
        {asked ? <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">That quotation could not be found.</p> : null}
        <p className="text-sm text-muted">A PO is recorded against an approved quotation. Choose one:</p>
        {approved.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
            No approved quotations yet. Approve a quotation first.{" "}
            <Link href="/quotations" className="underline">
              Go to quotations
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {approved.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <span className="font-medium">{q.number}</span> · {q.customerName}
                  <span className="block text-xs text-muted">
                    {formatRupees(q.grandTotal)}
                    {q.orderCount > 0 ? ` · ${q.orderCount} PO${q.orderCount === 1 ? "" : "s"} recorded` : ""}
                  </span>
                </span>
                <Link href={`/orders/new?quotation=${q.id}`} className={btn}>
                  Record PO
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const { quotation, customerName, revision, view, lines, orders } = data;

  if (!canRecordPurchaseOrder(view)) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {header}
        <p role="alert" data-testid="po-blocked" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {purchaseOrderRefusal(view)}.
        </p>
        <div>
          <Link href={`/quotations/${quotation.id}`} className={btn}>
            Open quotation {quotation.number ?? ""}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {header}
      <p className="text-sm text-muted">
        Against{" "}
        <Link href={`/quotations/${quotation.id}`} className="font-medium text-foreground hover:underline">
          {quotation.number}
        </Link>{" "}
        for {customerName}, approved {quotation.approvedAt ? formatDate(istDate(quotation.approvedAt)) : ""}.
        {orders.length > 0 ? (
          <>
            {" "}
            Already recorded against it:{" "}
            {orders.map((o, i) => (
              <span key={o.id}>
                {i > 0 ? ", " : ""}
                <Link href={`/orders/${o.id}`} className="underline">
                  {o.customerPoNumber}
                </Link>
              </span>
            ))}
            .
          </>
        ) : null}
      </p>
      <PoForm
        quotationId={quotation.id}
        quotationNumber={quotation.number ?? ""}
        today={istDate(new Date())}
        quotedAdvance={revision.advanceAmount}
        lines={lines.map((l) => ({
          id: l.id,
          lineNo: l.lineNo,
          description: l.description,
          hsnCode: l.hsnCode,
          unit: l.unit,
          quantity: l.quantity,
          rate: l.rate,
          discountPercent: l.discountPercent,
        }))}
      />
    </div>
  );
}
