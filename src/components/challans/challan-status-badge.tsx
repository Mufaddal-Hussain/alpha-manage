import type { ChallanStatus } from "@/db/schema";

const STYLES: Record<ChallanStatus, string> = {
  issued: "border-success/50 bg-success/10 text-success",
  cancelled: "border-danger/50 bg-danger/10 text-danger",
};

const LABELS: Record<ChallanStatus, string> = { issued: "Issued", cancelled: "Cancelled" };

export function ChallanStatusBadge({ status }: { status: ChallanStatus }) {
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>{LABELS[status]}</span>;
}
