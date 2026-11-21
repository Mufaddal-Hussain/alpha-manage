import Link from "next/link";
import { z } from "zod";
import { PoStatusBadge } from "@/components/orders/po-status-badge";
import { ChallanForm } from "@/components/challans/challan-form";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { istDate } from "@/lib/quotation/status";
import { getChallanForm, getOrdersToDeliver } from "@/server/challan-queries";

export const metadata = { title: "New challan · alpha-Manage" };

const btn = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60";

export default async function NewChallanPage({ searchParams }: PageProps<"/challans/new">) {
  const user = await requireUser();
  const query = await searchParams;
  const asked = typeof query.order === "string" && z.uuid().safeParse(query.order).success ? query.order : null;

  const header = (
    <div>
      <Link href="/challans" className="text-sm text-muted hover:underline">
        ← Challans
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">New delivery challan</h1>
    </div>
  );

  const data = asked ? await getChallanForm(asked) : null;

  // No PO chosen yet (or an unknown one): pick from the POs that still have something to deliver.
  if (!data) {
    const orders = await getOrdersToDeliver();
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {header}
        {asked ? <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">That purchase order could not be found.</p> : null}
        <p className="text-sm text-muted">A challan is issued against a customer PO. Choose one that still has items to deliver:</p>
        {orders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
            No purchase orders waiting for delivery.{" "}
            <Link href="/orders" className="underline">
              Go to purchase orders
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <span className="font-medium">PO {o.customerPoNumber}</span> · {o.customerName}
                  <span className="block text-xs text-muted">Dated {formatDate(o.poDate)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <PoStatusBadge status={o.status} />
                  <Link href={`/challans/new?order=${o.id}`} className={btn}>
                    New challan
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const { order, customerName, quotationNumber, revision, lines, challans } = data;

  if (order.status === "cancelled") {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {header}
        <p role="alert" data-testid="challan-blocked" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          This purchase order is cancelled, so no challan can be issued against it.
        </p>
        <div>
          <Link href={`/orders/${order.id}`} className={btn}>
            Open PO {order.customerPoNumber}
          </Link>
        </div>
      </div>
    );
  }

  const nothingPending = lines.every((l) => Number(l.pending) <= 0);
  const shipTo = revision.shipToName || revision.shipToAddress;
  const defaults = {
    consigneeName: shipTo ? revision.shipToName || revision.billToName : revision.billToName,
    consigneeAddress: (shipTo ? revision.shipToAddress : revision.billToAddress) ?? "",
    consigneeGstin: shipTo ? "" : (revision.billToGstin ?? ""),
    consigneeStateCode: shipTo ? revision.shipToStateCode || revision.placeOfSupplyStateCode : revision.billToStateCode,
    referenceNoDate: quotationNumber ? `${quotationNumber} dt. ${formatDate(revision.quotationDate)}` : "",
    buyersOrder: `${order.customerPoNumber} dt. ${formatDate(order.poDate)}`,
  };
  const issued = challans.filter((c) => c.status === "issued").length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {header}
      <p className="text-sm text-muted">
        Against{" "}
        <Link href={`/orders/${order.id}`} className="font-medium text-foreground hover:underline">
          PO {order.customerPoNumber}
        </Link>{" "}
        from {customerName}, dated {formatDate(order.poDate)}
        {issued > 0 ? `. ${issued} challan${issued === 1 ? "" : "s"} issued so far.` : "."}
      </p>
      {nothingPending ? (
        <p data-testid="nothing-pending" className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          Everything on this PO has been delivered.{" "}
          {user.role === "owner" ? "As the owner you can still issue a challan for more with an override and a reason." : "Only the owner can deliver more than was ordered."}
        </p>
      ) : null}
      <ChallanForm
        purchaseOrderId={order.id}
        poNumber={order.customerPoNumber}
        today={istDate(new Date())}
        minDate={order.poDate}
        defaults={defaults}
        isOwner={user.role === "owner"}
        lines={lines.map((l) => ({
          id: l.poLineId,
          lineNo: l.lineNo,
          description: l.description,
          hsnCode: l.hsnCode,
          unit: l.unit,
          ordered: l.ordered,
          delivered: l.delivered,
          pending: l.pending,
        }))}
      />
    </div>
  );
}
