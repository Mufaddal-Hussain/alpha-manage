"use client";

import { FormMessage, inputClass } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import {
  approveQuotationAction,
  deleteDraftAction,
  duplicateQuotationAction,
  reinstateQuotationAction,
  rejectQuotationAction,
  reviseQuotationAction,
  sendQuotationAction,
} from "@/server/quotations";
import type { QuotationAction } from "@/lib/quotation/status";

const btn = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60 disabled:opacity-60";
const primary = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";

type Action = (prev: import("@/lib/errors").ActionResult | null, formData: FormData) => Promise<import("@/lib/errors").ActionResult>;

function OneClick({ id, action, label, pendingLabel, variant = "plain", confirmText }: { id: string; action: Action; label: string; pendingLabel: string; variant?: "plain" | "primary"; confirmText?: string }) {
  const { result, pending, onSubmit } = useFormAction(action);
  return (
    <form
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) {
          e.preventDefault();
          return;
        }
        onSubmit(e);
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={variant === "primary" ? primary : btn}>
        {pending ? pendingLabel : label}
      </button>
      {result && !result.ok ? <FormMessage result={result} /> : null}
    </form>
  );
}

export function ReviseStarter({ quotationId }: { quotationId: string }) {
  return <OneClick id={quotationId} action={reviseQuotationAction} label="Start revision" pendingLabel="Starting…" variant="primary" />;
}

/** Only the actions that are valid for the quotation's current state are rendered (FR-016). */
export function StatusActions({ id, actions, hasNumber, currentValidUntil, expired }: { id: string; actions: QuotationAction[]; hasNumber: boolean; currentValidUntil: string; expired: boolean }) {
  const reject = useFormAction(rejectQuotationAction);
  const reinstate = useFormAction(reinstateQuotationAction);
  const can = (a: QuotationAction) => actions.includes(a);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-2">
        {can("issue") ? <OneClick id={id} action={sendQuotationAction} label={hasNumber ? "Issue revision" : "Issue quotation"} pendingLabel="Issuing…" variant="primary" /> : null}
        {can("approve") ? <OneClick id={id} action={approveQuotationAction} label="Approve" pendingLabel="Approving…" variant="primary" /> : null}
        {can("revise") ? <OneClick id={id} action={reviseQuotationAction} label="Revise" pendingLabel="Starting…" /> : null}
        {can("send") && !can("issue") ? <OneClick id={id} action={sendQuotationAction} label="Mark sent again" pendingLabel="Saving…" /> : null}
        <OneClick id={id} action={duplicateQuotationAction} label="Duplicate" pendingLabel="Duplicating…" />
        {can("delete") ? <OneClick id={id} action={deleteDraftAction} label="Delete draft" pendingLabel="Deleting…" confirmText="Delete this draft quotation? This cannot be undone." /> : null}
      </div>

      {can("reject") ? (
        <form onSubmit={reject.onSubmit} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-muted">
            Reason (optional)
            <input name="note" className={inputClass} placeholder="e.g. chose another supplier" />
          </label>
          <button type="submit" disabled={reject.pending} className={btn}>
            {reject.pending ? "Rejecting…" : "Reject"}
          </button>
          <div className="basis-full">
            <FormMessage result={reject.result} />
          </div>
        </form>
      ) : null}

      {can("reinstate") ? (
        <form onSubmit={reinstate.onSubmit} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-muted">
            Why is it being reinstated? (required)
            <input name="note" required className={inputClass} placeholder="e.g. customer came back" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            {expired ? "New valid until (required)" : "New valid until (optional)"}
            <input name="validUntil" type="date" defaultValue={expired ? "" : currentValidUntil} className={inputClass} />
          </label>
          <button type="submit" disabled={reinstate.pending} className={primary}>
            {reinstate.pending ? "Reinstating…" : "Reinstate"}
          </button>
          <div className="basis-full">
            <FormMessage result={reinstate.result} />
          </div>
        </form>
      ) : null}
    </div>
  );
}
