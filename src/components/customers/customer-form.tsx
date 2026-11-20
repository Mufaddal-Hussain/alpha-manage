"use client";

import { Field, FormMessage, inputClass, TextInput } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { Customer } from "@/db/schema";
import { STATE_CODES } from "@/lib/gst/state-codes";
import { createCustomer, updateCustomer } from "@/server/customers";

export function CustomerForm({ customer }: { customer: Customer | null }) {
  const { result, pending, onSubmit } = useFormAction(customer ? updateCustomer : createCustomer);
  const c = customer;
  const stateError = result && !result.ok ? result.fieldErrors?.stateCode : undefined;
  const typeError = result && !result.ok ? result.fieldErrors?.type : undefined;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8" noValidate>
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <FormMessage result={result} />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Customer</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" name="type" error={typeError}>
            <select id="type" name="type" defaultValue={c?.type ?? "company"} className={inputClass}>
              <option value="company">Company</option>
              <option value="individual">Individual</option>
            </select>
          </Field>
          <TextInput name="displayName" label="Name" hint="As it appears on quotations" defaultValue={c?.displayName ?? ""} required result={result} />
          <TextInput name="legalName" label="Legal name" hint="If different, for companies" defaultValue={c?.legalName ?? ""} result={result} />
          <TextInput
            name="gstin"
            label="GSTIN"
            hint="Optional for individuals. The state is taken from it if you leave State blank."
            defaultValue={c?.gstin ?? ""}
            maxLength={15}
            autoCapitalize="characters"
            className={`${inputClass} uppercase`}
            result={result}
          />
          <TextInput name="pan" label="PAN" defaultValue={c?.pan ?? ""} maxLength={10} className={`${inputClass} uppercase`} result={result} />
          <Field label="State" name="stateCode" error={stateError}>
            <select id="stateCode" name="stateCode" defaultValue={c?.stateCode ?? ""} className={inputClass} aria-invalid={stateError ? true : undefined}>
              <option value="">From GSTIN</option>
              {STATE_CODES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Billing address</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextInput name="addressLine1" label="Address line 1" defaultValue={c?.addressLine1 ?? ""} result={result} />
          </div>
          <div className="sm:col-span-2">
            <TextInput name="addressLine2" label="Address line 2" defaultValue={c?.addressLine2 ?? ""} result={result} />
          </div>
          <TextInput name="city" label="City" defaultValue={c?.city ?? ""} result={result} />
          <TextInput name="pincode" label="Pincode" defaultValue={c?.pincode ?? ""} inputMode="numeric" maxLength={6} result={result} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Contact</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput name="phone" label="Phone" type="tel" defaultValue={c?.phone ?? ""} result={result} />
          <TextInput name="email" label="Email" type="email" defaultValue={c?.email ?? ""} result={result} />
          <div className="sm:col-span-2">
            <Field label="Notes" name="notes" error={result && !result.ok ? result.fieldErrors?.notes : undefined}>
              <textarea id="notes" name="notes" rows={3} defaultValue={c?.notes ?? ""} className={inputClass} />
            </Field>
          </div>
        </div>
      </section>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : c ? "Save customer" : "Create customer"}
        </button>
      </div>
    </form>
  );
}
