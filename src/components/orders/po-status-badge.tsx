import type { PurchaseOrderStatus } from "@/db/schema";
import { PO_STATUS_LABELS } from "@/lib/order/labels";

const STYLES: Record<PurchaseOrderStatus, string> = {
  open: "border-accent/50 text-accent",
  partially_delivered: "border-accent/50 bg-accent/10 text-accent",
  delivered: "border-success/50 bg-success/10 text-success",
  cancelled: "border-danger/50 text-danger",
};

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>{PO_STATUS_LABELS[status]}</span>;
}
