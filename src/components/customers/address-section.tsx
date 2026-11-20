"use client";

import { Field, FormMessage, inputClass, TextInput } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { CustomerAddress } from "@/db/schema";
import { getStateByCode, STATE_CODES } from "@/lib/gst/state-codes";
import { deleteCustomerAddress, saveCustomerAddress } from "@/server/customers";

function AddressForm({ customerId, address, defaultStateCode }: { customerId: string; address: CustomerAddress | null; defaultStateCode: string }) {
  const { result, pending, formRef, onSubmit } = useFormAction(saveCustomerAddress, { resetOnSuccess: address === null });
  const stateError = result && !result.ok ? result.fieldErrors?.stateCode : undefined;
  const idPrefix = address?.id ?? "new-address";
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="id" value={address?.id ?? ""} />
      <FormMessage result={result} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput id={`${idPrefix}-label`} name="label" label="Label" hint="For example Koregaon Park site" defaultValue={address?.label ?? ""} required result={result} />
        <Field label="State" name={`${idPrefix}-state`} error={stateError}>
          <select id={`${idPrefix}-state`} name="stateCode" defaultValue={address?.stateCode ?? defaultStateCode} className={inputClass}>
            {STATE_CODES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <TextInput id={`${idPrefix}-line1`} name="addressLine1" label="Address line 1" defaultValue={address?.addressLine1 ?? ""} required result={result} />
        </div>
        <div className="sm:col-span-2">
          <TextInput id={`${idPrefix}-line2`} name="addressLine2" label="Address line 2" defaultValue={address?.addressLine2 ?? ""} result={result} />
        </div>
        <TextInput id={`${idPrefix}-city`} name="city" label="City" defaultValue={address?.city ?? ""} result={result} />
        <TextInput id={`${idPrefix}-pincode`} name="pincode" label="Pincode" defaultValue={address?.pincode ?? ""} inputMode="numeric" maxLength={6} result={result} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isDefaultShipping" defaultChecked={address?.isDefaultShipping ?? false} /> Default shipping address
      </label>
      <div>
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
          {pending ? "Saving…" : address ? "Save address" : "Add address"}
        </button>
      </div>
    </form>
  );
}

export function AddressSection({ customerId, addresses, defaultStateCode }: { customerId: string; addresses: CustomerAddress[]; defaultStateCode: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Shipping addresses</h2>
      {addresses.length === 0 ? <p className="text-sm text-muted">No shipping addresses yet. Deliveries go to the billing address until you add one.</p> : null}
      {addresses.map((a) => (
        <details key={a.id} className="rounded-lg border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {a.label}
            {a.isDefaultShipping ? <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">Default</span> : null}
            <span className="ml-2 font-normal text-muted">
              {[a.addressLine1, a.city, getStateByCode(a.stateCode)?.name].filter(Boolean).join(", ")}
            </span>
          </summary>
          <div className="mt-4 flex flex-col gap-3">
            <AddressForm customerId={customerId} address={a} defaultStateCode={defaultStateCode} />
            <form action={deleteCustomerAddress} className="border-t border-border pt-3">
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="customerId" value={customerId} />
              <button type="submit" className="rounded-md border border-danger/50 px-3 py-1.5 text-sm text-danger hover:bg-danger/10">
                Delete address
              </button>
            </form>
          </div>
        </details>
      ))}
      <details className="rounded-lg border border-dashed border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">Add a shipping address</summary>
        <div className="mt-4">
          <AddressForm customerId={customerId} address={null} defaultStateCode={defaultStateCode} />
        </div>
      </details>
    </section>
  );
}
