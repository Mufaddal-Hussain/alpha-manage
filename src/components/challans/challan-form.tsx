"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, FormMessage, inputClass, TextInput } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { formatQuantity, UNIT_LABELS } from "@/lib/format";
import { STATE_CODES } from "@/lib/gst/state-codes";
import { createChallanAction } from "@/server/challans";

export interface ChallanFormLine {
  id: string;
  lineNo: number;
  description: string;
  hsnCode: string;
  unit: "box" | "sqft" | "piece";
  ordered: string;
  delivered: string;
  pending: string;
}

export interface ChallanFormDefaults {
  consigneeName: string;
  consigneeAddress: string;
  consigneeGstin: string;
  consigneeStateCode: string;
  referenceNoDate: string;
  buyersOrder: string;
}

/** What the typed quantity means against what is pending, in words. */
function status(typed: string, pending: string): { text: string; tone: "ok" | "over" | "invalid" | "skip" } {
  const raw = typed.trim();
  if (raw === "" || Number(raw) === 0) return { text: "not on this challan", tone: "skip" };
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) return { text: "enter a number", tone: "invalid" };
  const excess = Number(raw) - Number(pending);
  if (excess > 0) return { text: `${formatQuantity(excess)} more than pending`, tone: "over" };
  return { text: Number(raw) === Number(pending) ? "all that is pending" : `${formatQuantity(Number(pending) - Number(raw))} will remain pending`, tone: "ok" };
}

export function ChallanForm({
  purchaseOrderId,
  poNumber,
  lines,
  today,
  minDate,
  defaults,
  isOwner,
}: {
  purchaseOrderId: string;
  poNumber: string;
  lines: ChallanFormLine[];
  today: string;
  minDate: string;
  defaults: ChallanFormDefaults;
  isOwner: boolean;
}) {
  const { result, pending, onSubmit } = useFormAction(createChallanAction);
  // Quantities start at what is still pending, as the contract says; an item with nothing pending starts empty.
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, Number(l.pending) > 0 ? String(Number(l.pending)) : ""])),
  );
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const anyOver = lines.some((l) => status(quantities[l.id] ?? "", l.pending).tone === "over");

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      <FormMessage result={result} />

      <section className="flex flex-col gap-3" aria-label="Items in this delivery">
        <div>
          <h2 className="text-lg font-medium">Items in this delivery</h2>
          <p className="text-sm text-muted">
            Quantities start at what is still pending on PO {poNumber}. Reduce a quantity for a part delivery; clear it (or enter 0) for an item that is not going out now.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Ordered</th>
                <th className="px-3 py-2 text-right font-medium">Delivered</th>
                <th className="px-3 py-2 text-right font-medium">Pending</th>
                <th className="px-3 py-2 font-medium">This challan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => {
                const typed = quantities[l.id] ?? "";
                const s = status(typed, l.pending);
                const error = errors[`qty:${l.id}`];
                const label = UNIT_LABELS[l.unit];
                return (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-muted">{l.lineNo}</td>
                    <td className="px-3 py-2">
                      {l.description}
                      <span className="block text-xs text-muted">HSN {l.hsnCode}</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(l.ordered)} {label}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(l.delivered)} {label}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap font-medium tabular-nums">{formatQuantity(l.pending)} {label}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input
                          name={`qty:${l.id}`}
                          aria-label={`Delivered quantity, line ${l.lineNo}`}
                          inputMode="decimal"
                          value={typed}
                          onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: e.target.value }))}
                          className={`${inputClass} w-28 text-right tabular-nums`}
                          aria-invalid={error || s.tone === "invalid" || (s.tone === "over" && !isOwner) ? true : undefined}
                        />
                        <span className="text-xs text-muted">{label}</span>
                      </div>
                      <p
                        data-testid={`pending-note-${l.lineNo}`}
                        className={`mt-1 text-xs ${s.tone === "over" ? (isOwner ? "text-accent" : "text-danger") : s.tone === "invalid" ? "text-danger" : "text-muted"}`}
                      >
                        {s.text}
                        {s.tone === "over" && !isOwner ? " (only the owner can deliver more than pending)" : ""}
                      </p>
                      {error ? <p className="text-xs text-danger">{error}</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {isOwner ? (
        <section className={`rounded-lg border bg-surface p-4 ${anyOver ? "border-accent" : "border-border"}`} aria-label="Override">
          <h2 className="text-sm font-semibold">Override with reason</h2>
          <p className="mb-2 text-xs text-muted">Only needed when a quantity above is more than what is pending. The override and the reason are recorded in the audit log.</p>
          <TextInput name="overrideReason" label="Reason for delivering more than pending" maxLength={500} autoComplete="off" result={result} />
        </section>
      ) : null}

      <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2" aria-label="Delivery details">
        <TextInput name="challanDate" label="Challan date" type="date" defaultValue={today} min={minDate} max={today} required result={result} />
        <TextInput name="dispatchedThrough" label="Dispatched through" maxLength={200} placeholder="e.g. own vehicle, transporter name" result={result} />
        <TextInput name="vehicleNo" label="Vehicle number" maxLength={40} placeholder="MH12 AB 1234" autoComplete="off" result={result} />
        <TextInput name="driverName" label="Driver name" maxLength={100} autoComplete="off" result={result} />
        <TextInput name="driverPhone" label="Driver phone" maxLength={30} inputMode="tel" autoComplete="off" result={result} />
        <TextInput name="destination" label="Destination" maxLength={200} result={result} />
        <TextInput name="modeTermsOfPayment" label="Mode/terms of payment" maxLength={200} placeholder="e.g. 100% advance" result={result} />
        <TextInput name="termsOfDelivery" label="Terms of delivery" maxLength={300} placeholder="e.g. ex-godown" result={result} />
        <TextInput name="referenceNoDate" label="Reference no. & date" maxLength={200} defaultValue={defaults.referenceNoDate} result={result} />
        <TextInput name="dispatchDocNo" label="Dispatch doc no." maxLength={100} result={result} />
        <TextInput name="otherReferences" label="Other references" maxLength={200} result={result} />
        <Field label="Buyer's order no. & date" name="buyersOrder" hint="Taken from the PO; it is printed on the challan.">
          <input id="buyersOrder" value={defaults.buyersOrder} readOnly className={`${inputClass} bg-border/30`} />
        </Field>
      </section>

      <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2" aria-label="Consignee">
        <div className="sm:col-span-2">
          <h2 className="text-sm font-semibold">Consignee (ship to)</h2>
          <p className="text-xs text-muted">Taken from the quotation&apos;s ship-to. Change it if this delivery goes to a different site. The buyer (bill to) is the quotation&apos;s bill-to and is printed as it was quoted.</p>
        </div>
        <TextInput name="consigneeName" label="Consignee name" required maxLength={200} defaultValue={defaults.consigneeName} result={result} />
        <TextInput name="consigneeGstin" label="Consignee GSTIN (optional)" maxLength={15} defaultValue={defaults.consigneeGstin} autoComplete="off" result={result} />
        <Field label="Delivery address" name="consigneeAddress">
          <textarea id="consigneeAddress" name="consigneeAddress" rows={2} maxLength={500} defaultValue={defaults.consigneeAddress} className={inputClass} />
        </Field>
        <Field label="State" name="consigneeStateCode" error={errors.consigneeStateCode ?? errors["consignee.stateCode"]}>
          <select id="consigneeStateCode" name="consigneeStateCode" defaultValue={defaults.consigneeStateCode} className={inputClass}>
            {STATE_CODES.map((st) => (
              <option key={st.code} value={st.code}>
                {st.name} ({st.code})
              </option>
            ))}
          </select>
        </Field>
      </section>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="showPrices" className="mt-1" />
        <span>
          Show prices on the challan
          <span className="block text-xs text-muted">Prints rate, tax and totals. Leave it off for a plain delivery note; either version can be printed later from the challan.</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Issuing…" : "Issue challan"}
        </button>
        <Link href={`/orders/${purchaseOrderId}`} className="text-sm text-muted hover:underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
