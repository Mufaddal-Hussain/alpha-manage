"use client";

import { useActionState } from "react";
import { Field, FormMessage, inputClass, SubmitButton, TextInput } from "@/components/ui/form";
import type { BusinessProfile, TermsTemplate } from "@/db/schema";
import { STATE_CODES } from "@/lib/gst/state-codes";
import { saveBusinessProfile } from "@/server/settings";

function ImageField({ name, label, fileId, removeName }: { name: string; label: string; fileId: string | null; removeName: string }) {
  return (
    <Field label={label} name={name} hint="PNG, JPEG or WebP">
      <div className="flex flex-col gap-2">
        {fileId ? (
          <div className="flex items-center gap-3">
            {/* Private file served through the authorised route; next/image would need loader config for no gain. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${fileId}`} alt={`Current ${label.toLowerCase()}`} className="max-h-16 max-w-48 rounded border border-border bg-white p-1" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={removeName} /> Remove
            </label>
          </div>
        ) : null}
        <input id={name} name={name} type="file" accept="image/png,image/jpeg,image/webp" className={inputClass} />
      </div>
    </Field>
  );
}

export function BusinessForm({ profile, templates }: { profile: BusinessProfile | null; templates: TermsTemplate[] }) {
  const [result, action] = useActionState(saveBusinessProfile, null);
  const p = profile;
  return (
    <form action={action} className="flex flex-col gap-8">
      <FormMessage result={result} />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Business</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput name="legalName" label="Legal name" defaultValue={p?.legalName} required result={result} />
          <TextInput name="tradeName" label="Trade name" defaultValue={p?.tradeName ?? ""} result={result} />
          <TextInput name="gstin" label="GSTIN" defaultValue={p?.gstin ?? ""} maxLength={15} className={`${inputClass} uppercase`} result={result} />
          <Field label="State" name="stateCode">
            <select id="stateCode" name="stateCode" defaultValue={p?.stateCode ?? "27"} className={inputClass}>
              {STATE_CODES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </Field>
          <TextInput name="phone" label="Phone" defaultValue={p?.phone ?? ""} result={result} />
          <TextInput name="email" label="Email" type="email" defaultValue={p?.email ?? ""} result={result} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Address</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextInput name="addressLine1" label="Address line 1" defaultValue={p?.addressLine1} required result={result} />
          </div>
          <div className="sm:col-span-2">
            <TextInput name="addressLine2" label="Address line 2" defaultValue={p?.addressLine2 ?? ""} result={result} />
          </div>
          <TextInput name="city" label="City" defaultValue={p?.city} required result={result} />
          <TextInput name="pincode" label="Pincode" defaultValue={p?.pincode ?? ""} inputMode="numeric" maxLength={6} result={result} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Branding</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ImageField name="logo" label="Logo" fileId={p?.logoFileId ?? null} removeName="removeLogo" />
          <ImageField name="brandStrip" label="Brand strip" fileId={p?.brandStripFileId ?? null} removeName="removeBrandStrip" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Bank details (printed on documents)</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextInput name="bankName" label="Bank" defaultValue={p?.bankName ?? ""} result={result} />
          <TextInput name="bankAccountNo" label="Account number" defaultValue={p?.bankAccountNo ?? ""} inputMode="numeric" result={result} />
          <TextInput name="bankIfsc" label="IFSC" defaultValue={p?.bankIfsc ?? ""} maxLength={11} className={`${inputClass} uppercase`} result={result} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Quotation defaults</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            name="defaultQuotationValidityDays"
            label="Validity (days)"
            type="number"
            min={1}
            max={365}
            defaultValue={p?.defaultQuotationValidityDays ?? 15}
            result={result}
          />
          <Field label="Default terms" name="defaultTermsTemplateId">
            <select id="defaultTermsTemplateId" name="defaultTermsTemplateId" defaultValue={p?.defaultTermsTemplateId ?? ""} className={inputClass}>
              <option value="">None</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Catalog defaults</h2>
        <p className="text-sm text-muted">
          Given to new products created by a price-list import when the template row has no HSN code. They are editable data on every product; the business verifies them.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput name="defaultHsnCode" label="Default HSN code" hint="Tiles are usually 6907" defaultValue={p?.defaultHsnCode ?? ""} maxLength={12} result={result} />
          <TextInput name="defaultGstRate" label="Default GST rate (%)" hint="Full rate, e.g. 18" inputMode="decimal" defaultValue={p?.defaultGstRate ? String(Number(p.defaultGstRate)) : ""} result={result} />
        </div>
      </section>

      <div>
        <SubmitButton>Save business profile</SubmitButton>
      </div>
    </form>
  );
}
