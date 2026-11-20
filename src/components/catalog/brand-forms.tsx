"use client";

import { Field, FormMessage, inputClass, TextInput } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { createBrand, createDistributor, saveBrand, saveDistributor } from "@/server/catalog";

const smallButton = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60 disabled:opacity-60";
const primaryButton = "inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";

export interface DistributorOption {
  id: string;
  name: string;
}

export function AddDistributorForm() {
  const { result, pending, formRef, onSubmit } = useFormAction(createDistributor, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4" noValidate>
      <h2 className="text-lg font-medium">Add a distributor</h2>
      <FormMessage result={result} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput id="distributor-name" name="name" label="Name" hint="e.g. Fun Enterprises" required result={result} />
        <TextInput id="distributor-gstin" name="gstin" label="GSTIN" maxLength={15} className={`${inputClass} uppercase`} result={result} />
        <TextInput id="distributor-phone" name="phone" label="Phone" result={result} />
        <TextInput id="distributor-email" name="email" label="Email" type="email" result={result} />
      </div>
      <div>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : "Add distributor"}
        </button>
      </div>
    </form>
  );
}

export function AddBrandForm({ distributors }: { distributors: DistributorOption[] }) {
  const { result, pending, formRef, onSubmit } = useFormAction(createBrand, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4" noValidate>
      <h2 className="text-lg font-medium">Add a brand</h2>
      <p className="text-sm text-muted">Brands are also created automatically when an import for a new brand is approved.</p>
      <FormMessage result={result} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput id="brand-name" name="name" label="Brand name" hint="e.g. colortile" required result={result} />
        <Field label="Distributor" name="brand-distributor">
          <select id="brand-distributor" name="distributorId" defaultValue="" className={inputClass}>
            <option value="">None yet</option>
            {distributors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : "Add brand"}
        </button>
      </div>
    </form>
  );
}

export function EditBrandForm({ brand, distributors }: { brand: { id: string; name: string; distributorId: string | null; active: boolean }; distributors: DistributorOption[] }) {
  const { result, pending, onSubmit } = useFormAction(saveBrand);
  const id = `brand-${brand.id}`;
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted hover:text-foreground">Edit</summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3" noValidate>
        <input type="hidden" name="id" value={brand.id} />
        <FormMessage result={result} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput id={`${id}-name`} name="name" label="Name" defaultValue={brand.name} required result={result} />
          <Field label="Distributor" name={`${id}-distributor`}>
            <select id={`${id}-distributor`} name="distributorId" defaultValue={brand.distributorId ?? ""} className={inputClass}>
              <option value="">None</option>
              {distributors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={brand.active} /> Active
        </label>
        <div>
          <button type="submit" disabled={pending} className={smallButton}>
            {pending ? "Saving…" : "Save brand"}
          </button>
        </div>
      </form>
    </details>
  );
}

export function EditDistributorForm({ distributor }: { distributor: { id: string; name: string; gstin: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null; active: boolean } }) {
  const { result, pending, onSubmit } = useFormAction(saveDistributor);
  const id = `distributor-${distributor.id}`;
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted hover:text-foreground">Edit distributor</summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3" noValidate>
        <input type="hidden" name="id" value={distributor.id} />
        <FormMessage result={result} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput id={`${id}-name`} name="name" label="Name" defaultValue={distributor.name} required result={result} />
          <TextInput id={`${id}-gstin`} name="gstin" label="GSTIN" defaultValue={distributor.gstin ?? ""} maxLength={15} className={`${inputClass} uppercase`} result={result} />
          <TextInput id={`${id}-phone`} name="phone" label="Phone" defaultValue={distributor.phone ?? ""} result={result} />
          <TextInput id={`${id}-email`} name="email" label="Email" type="email" defaultValue={distributor.email ?? ""} result={result} />
          <TextInput id={`${id}-address`} name="address" label="Address" defaultValue={distributor.address ?? ""} result={result} />
          <TextInput id={`${id}-notes`} name="notes" label="Notes" defaultValue={distributor.notes ?? ""} result={result} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={distributor.active} /> Active
        </label>
        <div>
          <button type="submit" disabled={pending} className={smallButton}>
            {pending ? "Saving…" : "Save distributor"}
          </button>
        </div>
      </form>
    </details>
  );
}
