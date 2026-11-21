"use client";

import { FormMessage, inputClass } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { cancelChallanAction } from "@/server/challans";

/** Cancel with a reason. The challan stays on file with its number; its quantities go back to pending. */
export function CancelChallanForm({ id, number }: { id: string; number: string }) {
  const { result, pending, onSubmit } = useFormAction(cancelChallanAction);
  return (
    <form
      onSubmit={(e) => {
        if (!window.confirm(`Cancel challan ${number}? It stays on file with its number, and its quantities become pending again.`)) {
          e.preventDefault();
          return;
        }
        onSubmit(e);
      }}
      className="flex flex-col gap-2"
      aria-label="Cancel challan"
    >
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs font-medium text-muted">
          Reason for cancelling (required)
          <input name="reason" required maxLength={500} className={inputClass} placeholder="e.g. goods were not dispatched" autoComplete="off" />
        </label>
        <button type="submit" disabled={pending} className="rounded-md border border-danger/50 px-3 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-60">
          {pending ? "Cancelling…" : "Cancel challan"}
        </button>
      </div>
      <FormMessage result={result} />
    </form>
  );
}
