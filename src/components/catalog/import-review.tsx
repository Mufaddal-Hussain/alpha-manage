"use client";

import { FormMessage, inputClass, TextInput } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { TEMPLATE_COLUMNS } from "@/lib/import/price-list-rules";
import { approveImport, fixImportRow } from "@/server/catalog";

const smallButton = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60 disabled:opacity-60";

export function ApproveForm({ jobId, included, discontinuing }: { jobId: string; included: number; discontinuing: number }) {
  const { result, pending, onSubmit } = useFormAction(approveImport);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4" noValidate>
      <input type="hidden" name="jobId" value={jobId} />
      <FormMessage result={result} />
      <p className="text-sm">
        Approving adds <strong>{included}</strong> {included === 1 ? "row" : "rows"} as a new price list version
        {discontinuing > 0 ? ` and marks products for ${discontinuing} removed ${discontinuing === 1 ? "group" : "groups"} discontinued` : ""}. Selling prices are never changed by an import; a changed cost
        only flags the product for review.
      </p>
      <div>
        <button
          type="submit"
          disabled={pending || (included === 0 && discontinuing === 0)}
          className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Approving…" : "Approve import"}
        </button>
      </div>
    </form>
  );
}

const COLUMN_LABEL: Record<(typeof TEMPLATE_COLUMNS)[number], string> = {
  brand: "Brand",
  list_label: "List label",
  effective_from: "Effective from",
  size: "Size",
  pieces_per_box: "Pieces per box",
  sqft_per_box: "Sq.ft per box",
  finish: "Finish",
  rate_per_box: "Rate per box",
  rate_per_sqft: "Rate per sq.ft",
  designs: "Designs (separated by ;)",
  hsn_code: "HSN code",
};

/** Edit the values of one row; it is validated and compared again, so an error row can be corrected here. */
export function FixRowForm({ rowId, raw }: { rowId: string; raw: Record<string, string> }) {
  const { result, pending, onSubmit } = useFormAction(fixImportRow);
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-accent hover:underline">Fix values</summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3" noValidate>
        <input type="hidden" name="rowId" value={rowId} />
        <FormMessage result={result} />
        <div className="grid gap-3 sm:grid-cols-3">
          {TEMPLATE_COLUMNS.filter((c) => c !== "designs").map((column) => (
            <TextInput key={column} id={`${rowId}-${column}`} name={column} label={COLUMN_LABEL[column]} defaultValue={raw[column] ?? ""} />
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${rowId}-designs`} className="text-sm font-medium">
            {COLUMN_LABEL.designs}
          </label>
          <textarea id={`${rowId}-designs`} name="designs" rows={3} defaultValue={raw.designs ?? ""} className={inputClass} />
        </div>
        <div>
          <button type="submit" disabled={pending} className={smallButton}>
            {pending ? "Checking…" : "Save and check again"}
          </button>
        </div>
      </form>
    </details>
  );
}
