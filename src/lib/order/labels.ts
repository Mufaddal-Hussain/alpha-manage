import type { PurchaseOrderStatus } from "@/db/schema/orders";

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  open: "Open",
  partially_delivered: "Partially delivered",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
