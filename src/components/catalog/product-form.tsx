"use client";

import { useState } from "react";
import { Field, FormMessage, inputClass, TextInput } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { Product } from "@/db/schema";
import { setSellingPrice } from "@/server/catalog";
import { createProduct, updateProduct } from "@/server/products";

/**
 * Add or edit a product by hand. `salesOnly` is the sales role on an existing product: everything but the
 * selling price is read-only (the server enforces this too).
 */
export function ProductForm({ product, salesOnly = false }: { product: Product | null; salesOnly?: boolean }) {
  const { result, pending, onSubmit } = useFormAction(product ? (salesOnly ? setSellingPrice : updateProduct) : createProduct);
  const p = product;
  // Price and margin on cost move together as you type; the server recomputes them exactly when it saves.
  const cost = p?.costPerUnit ? Number(p.costPerUnit) : null;
  const [price, setPrice] = useState(p?.sellingPricePerUnit ?? "");
  const [margin, setMargin] = useState(p?.marginPercent ?? "");
  function onPrice(value: string) {
    setPrice(value);
    const n = Number(value);
    setMargin(cost && value.trim() !== "" && Number.isFinite(n) ? (((n - cost) / cost) * 100).toFixed(2) : "");
  }
  function onMargin(value: string) {
    setMargin(value);
    const m = Number(value);
    if (cost && value.trim() !== "" && Number.isFinite(m)) setPrice((cost * (1 + m / 100)).toFixed(2));
  }
  const locked = salesOnly;
  const unitError = result && !result.ok ? result.fieldErrors?.unit : undefined;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <FormMessage result={result} />
      {locked ? <p className="text-sm text-muted">Sales staff can change the selling price; the other details are changed by the owner.</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextInput name="name" label="Name" hint="As it appears on quotations, e.g. ATN 600X600 8538 Plain Ivory Matt" defaultValue={p?.name ?? ""} required disabled={locked} result={result} />
        </div>
        <TextInput name="code" label="Code" defaultValue={p?.code ?? ""} disabled={locked} result={result} />
        <TextInput name="sizeLabel" label="Size" hint="e.g. 600 x 600" defaultValue={p?.sizeLabel ?? ""} disabled={locked} result={result} />
        <TextInput name="finish" label="Finish" hint="e.g. Glossy, Rustic Matt" defaultValue={p?.finish ?? ""} disabled={locked} result={result} />
        <Field label="Sold by" name="unit" error={unitError}>
          <select id="unit" name="unit" defaultValue={p?.unit ?? "box"} className={inputClass} disabled={locked}>
            <option value="box">Box</option>
            <option value="sqft">Sq.ft</option>
            <option value="piece">Piece</option>
          </select>
        </Field>
        <TextInput name="piecesPerBox" label="Pieces per box" inputMode="numeric" defaultValue={p?.piecesPerBox ?? ""} disabled={locked} result={result} />
        <TextInput
          name="sqftPerBox"
          label="Sq.ft per box"
          hint="Needed for tiles sold by the box. Leave blank for granite and special items."
          inputMode="decimal"
          defaultValue={p?.sqftPerBox ? String(Number(p.sqftPerBox)) : ""}
          disabled={locked}
          result={result}
        />
        <TextInput name="hsnCode" label="HSN code" hint="Verified by the business; tiles are usually 6907" defaultValue={p?.hsnCode ?? ""} required disabled={locked} result={result} />
        <TextInput name="gstRate" label="GST rate (%)" hint="Full rate, e.g. 18" inputMode="decimal" defaultValue={p ? String(Number(p.gstRate)) : ""} required disabled={locked} result={result} />
        <TextInput
          name="sellingPricePerUnit"
          label="Selling price (₹, ex-GST)"
          hint="Per box, sq.ft or piece, whichever it is sold by"
          inputMode="decimal"
          value={price}
          onChange={(e) => onPrice(e.target.value)}
          result={result}
        />
        {cost !== null ? (
          <TextInput
            name="marginPercent"
            label="Margin on cost (%)"
            hint={`Selling price = cost ₹${cost.toFixed(2)} × (1 + margin). Change either; the other follows.`}
            inputMode="decimal"
            value={margin}
            onChange={(e) => onMargin(e.target.value)}
            result={result}
          />
        ) : null}
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : p ? (salesOnly ? "Save selling price" : "Save product") : "Create product"}
        </button>
      </div>
    </form>
  );
}
