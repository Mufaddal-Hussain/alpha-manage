"use client";

import { Field, FormMessage, inputClass } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { startPriceListImport } from "@/server/catalog";

export function ImportForm({ brands }: { brands: { id: string; name: string }[] }) {
  const { result, pending, onSubmit } = useFormAction(startPriceListImport);
  const fileError = result && !result.ok ? result.fieldErrors?.file : undefined;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4" noValidate>
      <FormMessage result={result} />
      <Field label="Filled-in template" name="file" hint=".xlsx or .csv, built from the template below. One row per price of a group." error={fileError}>
        <input id="file" name="file" type="file" accept=".xlsx,.csv" required className={inputClass} />
      </Field>
      <Field label="Brand" name="brandId" hint="Optional. If you choose one, every row in the file must be for that brand. Otherwise each row's brand column decides, and new brands are created when you approve.">
        <select id="brandId" name="brandId" defaultValue="" className={inputClass}>
          <option value="">Whatever the file says</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Original price list (PDF), optional" name="reference" hint="Kept with the price list version as a reference you can open later. It is not read or imported.">
        <input id="reference" name="reference" type="file" accept=".pdf,application/pdf" className={inputClass} />
      </Field>
      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Reading file…" : "Read and review"}
        </button>
        <p className="mt-2 text-xs text-muted">Nothing is saved to the catalog until you approve on the next screen.</p>
      </div>
    </form>
  );
}
