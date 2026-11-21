"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, FormMessage, inputClass, TextInput } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { formatInr, formatQuantity, UNIT_LABELS } from "@/lib/format";
import { recordPurchaseOrderAction } from "@/server/orders";

export interface PoFormLine {
  id: string;
  lineNo: number;
  description: string;
  hsnCode: string;
  unit: "box" | "sqft" | "piece";
  /** Quoted quantity, NUMERIC text. */
  quantity: string;
  rate: string;
  discountPercent: string;
}

/** Difference between what is typed and what was quoted, in words: "same as quoted", "1 fewer", "not ordered"... */
function difference(quoted: string, typed: string, unit: string): { text: string; tone: "same" | "changed" | "invalid" } {
  const raw = typed.trim();
  if (raw === "" || Number(raw) === 0) return { text: "not ordered", tone: "changed" };
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) return { text: "enter a number", tone: "invalid" };
  const delta = Number(raw) - Number(quoted);
  if (delta === 0) return { text: "same as quoted", tone: "same" };
  return { text: `${formatQuantity(Math.abs(delta))} ${unit} ${delta < 0 ? "fewer" : "more"} than quoted`, tone: "changed" };
}

export function PoForm({
  quotationId,
  quotationNumber,
  lines,
  today,
  quotedAdvance,
}: {
  quotationId: string;
  quotationNumber: string;
  lines: PoFormLine[];
  today: string;
  quotedAdvance: string;
}) {
  const { result, pending, onSubmit } = useFormAction(recordPurchaseOrderAction);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(Number(l.quantity))])));
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const duplicate = Boolean(errors.confirmDuplicate);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="quotationId" value={quotationId} />
      <FormMessage result={result} />

      <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2" aria-label="PO details">
        <TextInput name="customerPoNumber" label="Customer PO number" required maxLength={60} autoComplete="off" result={result} />
        <TextInput name="poDate" label="PO date" type="date" defaultValue={today} required result={result} />
        <TextInput
          name="advanceReceived"
          label="Advance received (₹)"
          inputMode="decimal"
          defaultValue="0"
          hint={Number(quotedAdvance) > 0 ? `The quotation asked for an advance of ₹ ${formatInr(quotedAdvance)}.` : "Money received with the PO, if any."}
          result={result}
        />
        <Field label="Attach the PO" name="files" hint="PDF, or a PNG, JPEG or WebP picture of it. Up to 5 files, 10 MB each." error={errors.files}>
          <input id="files" name="files" type="file" multiple accept=".pdf,application/pdf,image/png,image/jpeg,image/webp" className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes" name="notes">
            <textarea id="notes" name="notes" rows={2} maxLength={2000} className={inputClass} placeholder="e.g. deliver after the 1st, site contact changed" />
          </Field>
        </div>
        {duplicate ? (
          <label className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm sm:col-span-2">
            <input type="checkbox" name="confirmDuplicate" className="mt-1" />
            <span>
              This customer already has a PO with this number (
              <Link href={`/orders/${errors.confirmDuplicate}`} className="underline" target="_blank">
                see it
              </Link>
              ). Record this one anyway; the override is noted in the audit log.
            </span>
          </label>
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-label="Ordered items">
        <div>
          <h2 className="text-lg font-medium">Ordered quantities</h2>
          <p className="text-sm text-muted">
            From quotation {quotationNumber}. Change a quantity if the PO differs; clear it (or enter 0) for an item the customer did not order.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Quoted</th>
                <th className="px-3 py-2 font-medium">Ordered</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => {
                const typed = quantities[l.id] ?? "";
                const diff = difference(l.quantity, typed, UNIT_LABELS[l.unit].toLowerCase());
                const error = errors[`qty:${l.id}`];
                return (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-muted">{l.lineNo}</td>
                    <td className="px-3 py-2">
                      {l.description}
                      <span className="block text-xs text-muted">HSN {l.hsnCode}</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      {formatQuantity(l.quantity)} {UNIT_LABELS[l.unit]}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input
                          name={`qty:${l.id}`}
                          aria-label={`Ordered quantity, line ${l.lineNo}`}
                          inputMode="decimal"
                          value={typed}
                          onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: e.target.value }))}
                          className={`${inputClass} w-28 text-right tabular-nums`}
                          aria-invalid={error || diff.tone === "invalid" ? true : undefined}
                        />
                        <span className="text-xs text-muted">{UNIT_LABELS[l.unit]}</span>
                      </div>
                      <p data-testid={`difference-${l.lineNo}`} className={`mt-1 text-xs ${diff.tone === "same" ? "text-muted" : diff.tone === "invalid" ? "text-danger" : "text-accent"}`}>
                        {diff.text}
                      </p>
                      {error ? <p className="text-xs text-danger">{error}</p> : null}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      {formatInr(l.rate)}
                      {Number(l.discountPercent) > 0 ? <span className="block text-xs text-muted">{formatQuantity(l.discountPercent)}% off</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Charges on the quotation (transport and the like) are not ordered items and do not appear here.</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Recording…" : "Record PO"}
        </button>
        <Link href={`/quotations/${quotationId}`} className="text-sm text-muted hover:underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
