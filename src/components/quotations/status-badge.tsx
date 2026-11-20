import { STATUS_LABELS, type DisplayStatus } from "@/lib/quotation/status";

const STYLES: Record<DisplayStatus, string> = {
  draft: "border-border text-muted",
  sent: "border-accent/50 text-accent",
  approved: "border-success/50 bg-success/10 text-success",
  rejected: "border-danger/50 bg-danger/10 text-danger",
  expired: "border-danger/50 text-danger",
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>{STATUS_LABELS[status]}</span>;
}
