"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { inputClass } from "@/components/ui/form";
import { formatInr, formatQuantity } from "@/lib/format";
import { STATE_CODES, getStateByCode } from "@/lib/gst/state-codes";
import { taxMode } from "@/lib/gst";
import { addDays } from "@/lib/quotation/status";
import { computeQuotation, resolveQuantity, type QuoteLineInput } from "@/lib/quotation/calc";
import type { EditorInitial, EditorLine } from "@/lib/quotation/editor-state";
import { issueQuotationAction, saveQuotationDraft } from "@/server/quotations";
import { lookupCustomerDetail, lookupCustomers, lookupProducts, type CustomerDetailOption, type CustomerOption, type ProductOption } from "@/server/quotation-lookups";

export interface EditorSettings {
  businessStateCode: string | null;
  validityDays: number;
  templates: { id: string; name: string; text: string }[];
  defaultTermsText: string;
  today: string;
}

export interface ChargeOption {
  id: string;
  name: string;
  hsnSacCode: string;
  gstRate: string;
}

const small = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const btn = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60 disabled:opacity-60";
const stateLabel = (code: string) => getStateByCode(code)?.name ?? code;

function emptyInitial(settings: EditorSettings): EditorInitial {
  return {
    quotationId: null,
    number: null,
    revisionNo: 1,
    customer: null,
    quotationDate: settings.today,
    validUntil: addDays(settings.today, settings.validityDays),
    billTo: { name: "", gstin: "", address: "", stateCode: settings.businessStateCode ?? "" },
    shipTo: { address: "", stateCode: settings.businessStateCode ?? "", contactName: "", contactPhone: "", sameAsBillTo: true },
    layout: "gst_quotation",
    terms: settings.defaultTermsText,
    advanceAmount: "",
    notes: "",
    lines: [],
  };
}

interface Resolved {
  quantity: string | null;
  alt: string | null;
  error: string | null;
}

/** Quantity in the line's unit plus the other measure, or the reason it cannot be worked out yet. */
function resolveLine(line: EditorLine): Resolved {
  if (line.kind === "charge") return { quantity: "1", alt: null, error: null };
  if (line.entered.trim() === "") return { quantity: null, alt: null, error: "Enter a quantity" };
  if (!/^\d+(\.\d{1,3})?$/.test(line.entered.trim())) return { quantity: null, alt: null, error: "Quantity must be a number" };
  try {
    const r = resolveQuantity({ unit: line.unit, entered: line.entered.trim(), enteredIn: line.enteredIn, sqftPerBox: line.sqftPerBox });
    if (r.quantity.lte(0)) return { quantity: null, alt: null, error: "Quantity must be more than zero" };
    return { quantity: r.quantity.toString(), alt: r.quantityAlt?.toString() ?? null, error: null };
  } catch (error) {
    return { quantity: null, alt: null, error: error instanceof RangeError ? error.message : "Check the quantity" };
  }
}

export function QuotationEditor({ settings, chargeTypes, initial }: { settings: EditorSettings; chargeTypes: ChargeOption[]; initial: EditorInitial | null }) {
  const router = useRouter();
  const start = useMemo(() => initial ?? emptyInitial(settings), [initial, settings]);
  const nextKey = useRef(0);
  const newKey = () => `new-${nextKey.current++}`;

  const [quotationId, setQuotationId] = useState(start.quotationId);
  const [customer, setCustomer] = useState<CustomerDetailOption | null>(null);
  const [customerChoice, setCustomerChoice] = useState(start.customer);
  const [billTo, setBillTo] = useState(start.billTo);
  const [shipTo, setShipTo] = useState(start.shipTo);
  const [shipSource, setShipSource] = useState<string>(start.shipTo.sameAsBillTo ? "same" : "other");
  const [quotationDate, setQuotationDate] = useState(start.quotationDate);
  const [validUntil, setValidUntil] = useState(start.validUntil);
  const [layout, setLayout] = useState(start.layout);
  const [terms, setTerms] = useState(start.terms);
  const [advance, setAdvance] = useState(start.advanceAmount);
  const [notes, setNotes] = useState(start.notes);
  const [lines, setLines] = useState<EditorLine[]>(start.lines);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Editing an existing draft: load the customer's addresses and contacts for the ship-to pickers.
  useEffect(() => {
    if (!start.customer) return;
    let cancelled = false;
    lookupCustomerDetail(start.customer.id).then((detail) => {
      if (!cancelled && detail) setCustomer(detail);
    });
    return () => {
      cancelled = true;
    };
  }, [start.customer]);

  // ---- customer search -----------------------------------------------------
  const [customerTerm, setCustomerTerm] = useState("");
  const [fetchedCustomers, setCustomerResults] = useState<CustomerOption[]>([]);
  // Results only show while a term is typed and no customer is chosen; stale results are never rendered.
  const customerResults = customerChoice || customerTerm.trim().length < 1 ? [] : fetchedCustomers;
  useEffect(() => {
    if (customerChoice || customerTerm.trim().length < 1) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      lookupCustomers(customerTerm).then((rows) => {
        if (!cancelled) setCustomerResults(rows);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerTerm, customerChoice]);

  async function chooseCustomer(option: CustomerOption) {
    const detail = await lookupCustomerDetail(option.id);
    if (!detail) return;
    setCustomer(detail);
    setCustomerChoice({ id: detail.id, displayName: detail.displayName });
    setCustomerTerm("");
    setCustomerResults([]);
    setBillTo({ name: detail.displayName, gstin: detail.gstin ?? "", address: detail.billingAddress, stateCode: detail.stateCode });
    const defaultAddress = detail.addresses.find((a) => a.isDefault);
    if (defaultAddress) {
      setShipSource(defaultAddress.id);
      setShipTo((s) => ({ ...s, address: defaultAddress.address, stateCode: defaultAddress.stateCode, sameAsBillTo: false }));
    } else {
      setShipSource("same");
      setShipTo((s) => ({ ...s, sameAsBillTo: true }));
    }
  }

  function chooseShipSource(value: string) {
    setShipSource(value);
    if (value === "same") setShipTo((s) => ({ ...s, sameAsBillTo: true }));
    else if (value === "other") setShipTo((s) => ({ ...s, sameAsBillTo: false }));
    else {
      const a = customer?.addresses.find((x) => x.id === value);
      if (a) setShipTo((s) => ({ ...s, address: a.address, stateCode: a.stateCode, sameAsBillTo: false }));
    }
  }

  // ---- product search ------------------------------------------------------
  const [productTerm, setProductTerm] = useState("");
  const [fetchedProducts, setProductResults] = useState<ProductOption[]>([]);
  const productResults = productTerm.trim().length < 1 ? [] : fetchedProducts;
  useEffect(() => {
    if (productTerm.trim().length < 1) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      lookupProducts(productTerm).then((rows) => {
        if (!cancelled) setProductResults(rows);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [productTerm]);

  function addProduct(p: ProductOption) {
    setLines((current) => [
      ...current,
      {
        key: newKey(),
        kind: "product",
        productId: p.id,
        chargeTypeId: null,
        description: p.name,
        hsnCode: p.hsnCode,
        unit: p.unit,
        piecesPerBox: p.piecesPerBox,
        sqftPerBox: p.sqftPerBox,
        entered: "1",
        enteredIn: p.unit,
        rate: p.sellingPrice === null ? "" : String(Number(p.sellingPrice)),
        discountPercent: "0",
        gstRate: p.gstRate,
      },
    ]);
    setProductTerm("");
    setProductResults([]);
  }

  function addFreeText() {
    setLines((current) => [
      ...current,
      { key: newKey(), kind: "product", productId: null, chargeTypeId: null, description: "", hsnCode: "", unit: "sqft", piecesPerBox: null, sqftPerBox: null, entered: "1", enteredIn: "sqft", rate: "", discountPercent: "0", gstRate: "" },
    ]);
  }

  function addCharge(c: ChargeOption) {
    setLines((current) => [
      ...current,
      { key: newKey(), kind: "charge", productId: null, chargeTypeId: c.id, description: c.name, hsnCode: c.hsnSacCode, unit: "piece", piecesPerBox: null, sqftPerBox: null, entered: "1", enteredIn: "piece", rate: "", discountPercent: "0", gstRate: String(Number(c.gstRate)) },
    ]);
  }

  const updateLine = (key: string, patch: Partial<EditorLine>) => setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((current) => current.filter((l) => l.key !== key));
  const moveLine = (key: string, delta: -1 | 1) =>
    setLines((current) => {
      const i = current.findIndex((l) => l.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= current.length) return current;
      const copy = [...current];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  // ---- live totals ---------------------------------------------------------
  const placeOfSupply = shipTo.sameAsBillTo ? billTo.stateCode : shipTo.stateCode || billTo.stateCode;
  const mode = settings.businessStateCode && placeOfSupply ? taxMode(placeOfSupply, settings.businessStateCode) : null;
  const resolved = useMemo(() => lines.map(resolveLine), [lines]);
  const totals = useMemo(() => {
    if (!mode || lines.length === 0) return null;
    const inputs: QuoteLineInput[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const q = resolved[i];
      if (q.quantity === null || !/^\d+(\.\d{1,2})?$/.test(l.rate.trim()) || !/^\d+(\.\d{1,2})?$/.test(l.gstRate.trim())) return null;
      const discount = l.discountPercent.trim() === "" ? "0" : l.discountPercent.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(discount) || Number(discount) > 100 || Number(l.gstRate) > 100) return null;
      inputs.push({ kind: l.kind, quantity: q.quantity, rate: l.rate.trim(), discountPercent: discount, gstRate: l.gstRate.trim(), hsnCode: l.hsnCode });
    }
    try {
      return computeQuotation(inputs, mode, { advance: /^\d+(\.\d{1,2})?$/.test(advance.trim()) ? advance.trim() : 0 });
    } catch {
      return null;
    }
  }, [lines, resolved, mode, advance]);

  // ---- save / issue --------------------------------------------------------
  function payload() {
    const sameShip = shipTo.sameAsBillTo;
    return {
      quotationId,
      customerId: customerChoice?.id ?? "",
      quotationDate,
      validUntil,
      billTo: { name: billTo.name, gstin: billTo.gstin, address: billTo.address, stateCode: billTo.stateCode },
      shipTo: {
        name: null,
        address: sameShip ? null : shipTo.address,
        stateCode: sameShip ? null : shipTo.stateCode,
        contactName: shipTo.contactName,
        contactPhone: shipTo.contactPhone,
      },
      layout,
      terms,
      advanceAmount: advance.trim() === "" ? "0" : advance.trim(),
      notes,
      lines: lines.map((l, i) => ({
        kind: l.kind,
        productId: l.productId,
        chargeTypeId: l.chargeTypeId,
        description: l.description,
        hsnCode: l.hsnCode,
        unit: l.unit,
        piecesPerBox: l.piecesPerBox,
        sqftPerBox: l.sqftPerBox,
        quantity: resolved[i].quantity ?? l.entered,
        rate: l.rate,
        discountPercent: l.discountPercent.trim() === "" ? "0" : l.discountPercent,
        gstRate: l.gstRate,
      })),
    };
  }

  function run(issue: boolean) {
    setMessage(null);
    startTransition(async () => {
      const saved = await saveQuotationDraft(payload());
      if (!saved.ok || !saved.data) {
        setMessage({ ok: false, text: saved.ok ? "Could not save the draft" : saved.message });
        return;
      }
      setQuotationId(saved.data.id);
      if (!issue) {
        setMessage({ ok: true, text: "Draft saved" });
        return;
      }
      const issued = await issueQuotationAction(saved.data.id);
      if (!issued.ok) {
        setMessage({ ok: false, text: `${issued.message}. Your changes are saved as a draft.` });
        return;
      }
      router.push(`/quotations/${saved.data.id}`);
    });
  }

  const isRevision = start.number !== null;
  const customerContacts = customer?.contacts ?? [];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(false);
      }}
      className="flex flex-col gap-8"
      noValidate
    >
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`rounded-md border px-3 py-2 text-sm ${message.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>
          {message.text}
        </p>
      ) : null}

      {/* Customer */}
      <section className="flex flex-col gap-3" aria-labelledby="customer-heading">
        <h2 id="customer-heading" className="text-lg font-medium">Customer</h2>
        {customerChoice ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <span className="font-medium">{customerChoice.displayName}</span>
            {!isRevision ? (
              <button type="button" className={btn} onClick={() => { setCustomerChoice(null); setCustomer(null); }}>
                Change customer
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="search"
              value={customerTerm}
              onChange={(e) => setCustomerTerm(e.target.value)}
              placeholder="Search customer by name, GSTIN or phone"
              aria-label="Find customer"
              className={inputClass}
            />
            {customerResults.length > 0 ? (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface" aria-label="Customer results">
                {customerResults.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => chooseCustomer(c)} className="flex w-full flex-wrap justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-border/40">
                      <span className="font-medium">{c.displayName}</span>
                      <span className="text-muted">{stateLabel(c.stateCode)}{c.gstin ? ` · ${c.gstin}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : customerTerm.trim() ? (
              <p className="text-sm text-muted">No customer found. Add them under Customers first.</p>
            ) : null}
          </div>
        )}
      </section>

      {/* Bill to / ship to */}
      <section className="grid gap-6 md:grid-cols-2" aria-label="Parties">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Bill to</h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Name
            <input className={inputClass} value={billTo.name} onChange={(e) => setBillTo({ ...billTo, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            GSTIN
            <input className={`${inputClass} uppercase`} value={billTo.gstin} maxLength={15} onChange={(e) => setBillTo({ ...billTo, gstin: e.target.value.toUpperCase() })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Address
            <textarea className={inputClass} rows={3} value={billTo.address} onChange={(e) => setBillTo({ ...billTo, address: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            State
            <select className={inputClass} value={billTo.stateCode} onChange={(e) => setBillTo({ ...billTo, stateCode: e.target.value })}>
              <option value="">Choose a state</option>
              {STATE_CODES.map((s) => (
                <option key={s.code} value={s.code}>{s.code} · {s.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Ship to / site</h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Delivery address
            <select className={inputClass} value={shipSource} onChange={(e) => chooseShipSource(e.target.value)}>
              <option value="same">Same as bill-to</option>
              {(customer?.addresses ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.label}: {a.address}</option>
              ))}
              <option value="other">Other address (type below)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Address
            <textarea className={inputClass} rows={3} disabled={shipTo.sameAsBillTo} value={shipTo.sameAsBillTo ? billTo.address : shipTo.address} onChange={(e) => setShipTo({ ...shipTo, address: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            State
            <select className={inputClass} disabled={shipTo.sameAsBillTo} value={shipTo.sameAsBillTo ? billTo.stateCode : shipTo.stateCode} onChange={(e) => setShipTo({ ...shipTo, stateCode: e.target.value })}>
              <option value="">Choose a state</option>
              {STATE_CODES.map((s) => (
                <option key={s.code} value={s.code}>{s.code} · {s.name}</option>
              ))}
            </select>
          </label>
          {customerContacts.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Site contact
              <select
                className={inputClass}
                value=""
                onChange={(e) => {
                  const c = customerContacts.find((x) => x.id === e.target.value);
                  if (c) setShipTo({ ...shipTo, contactName: c.name, contactPhone: c.phone ?? "" });
                }}
              >
                <option value="">Pick a saved contact…</option>
                {customerContacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Contact person
              <input className={inputClass} value={shipTo.contactName} onChange={(e) => setShipTo({ ...shipTo, contactName: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Contact phone
              <input className={inputClass} type="tel" value={shipTo.contactPhone} onChange={(e) => setShipTo({ ...shipTo, contactPhone: e.target.value })} />
            </label>
          </div>
          {mode ? (
            <p className="text-sm text-muted">
              Place of supply: {stateLabel(placeOfSupply)}. {mode === "intra" ? "Same state as the business: CGST + SGST." : "Different state: IGST."}
            </p>
          ) : null}
        </div>
      </section>

      {/* Dates and layout */}
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Dates and layout">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Quotation date
          <input className={inputClass} type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Valid until
          <input className={inputClass} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Layout
          <select className={inputClass} value={layout} onChange={(e) => setLayout(e.target.value as typeof layout)}>
            <option value="gst_quotation">GST quotation</option>
            <option value="estimate">Estimate</option>
          </select>
        </label>
      </section>

      {/* Lines */}
      <section className="flex flex-col gap-4" aria-labelledby="lines-heading">
        <h2 id="lines-heading" className="text-lg font-medium">Items</h2>

        <div className="flex flex-col gap-2">
          <input
            type="search"
            value={productTerm}
            onChange={(e) => setProductTerm(e.target.value)}
            placeholder="Search products by name, brand, code, size or finish"
            aria-label="Add product"
            className={inputClass}
          />
          {productResults.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface" aria-label="Product results">
              {productResults.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => addProduct(p)} className="flex w-full flex-wrap justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-border/40">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted">
                      {[p.brandName, p.sizeLabel, p.finish].filter(Boolean).join(" · ")}
                      {p.sellingPrice ? ` · ₹ ${formatInr(p.sellingPrice)} / ${p.unit === "sqft" ? "sq.ft" : p.unit}` : " · no price set"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : productTerm.trim() ? (
            <p className="text-sm text-muted">No active product found. Add it under Products, or use a free-text item.</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={addFreeText}>
            + Free-text item
          </button>
          {chargeTypes.map((c) => (
            <button key={c.id} type="button" className={btn} onClick={() => addCharge(c)}>
              + {c.name}
            </button>
          ))}
        </div>

        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">No items yet. Search for a product above.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {lines.map((l, i) => {
              const q = resolved[i];
              const lineResult = totals?.lines[i];
              const hasPacking = l.unit !== "piece" && l.sqftPerBox !== null;
              return (
                <li key={l.key} className="rounded-lg border border-border bg-surface p-3" aria-label={`Line ${i + 1}`}>
                  <div className="flex items-start gap-2">
                    <span className="mt-2 w-6 shrink-0 text-sm text-muted">{i + 1}</span>
                    <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-6">
                      <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted sm:col-span-4">
                        Description
                        <input className={small} value={l.description} aria-label={`Description, line ${i + 1}`} onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                      </label>
                      <label className="col-span-1 flex flex-col gap-1 text-xs font-medium text-muted sm:col-span-2">
                        HSN/SAC
                        <input className={small} value={l.hsnCode} aria-label={`HSN, line ${i + 1}`} onChange={(e) => updateLine(l.key, { hsnCode: e.target.value })} />
                      </label>

                      {l.kind === "product" ? (
                        <div className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted sm:col-span-2">
                          <span>Quantity</span>
                          <div className="flex gap-1">
                            <input className={small} inputMode="decimal" value={l.entered} aria-label={`Quantity, line ${i + 1}`} onChange={(e) => updateLine(l.key, { entered: e.target.value })} />
                            {hasPacking ? (
                              <select
                                className={`${small} w-24`}
                                value={l.enteredIn}
                                aria-label={`Quantity measure, line ${i + 1}`}
                                onChange={(e) => {
                                  // Switching measure keeps the area/boxes the line already stands for.
                                  const next = e.target.value as EditorLine["enteredIn"];
                                  const current = resolveLine(l);
                                  let entered = l.entered;
                                  if (current.quantity !== null) {
                                    entered = next === l.unit ? current.quantity : (current.alt ?? l.entered);
                                  }
                                  updateLine(l.key, { enteredIn: next, entered: formatQuantity(entered).replace(/,/g, "") });
                                }}
                              >
                                {l.unit === "box" ? (
                                  <>
                                    <option value="box">Boxes</option>
                                    <option value="sqft">Sq.ft</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="sqft">Sq.ft</option>
                                    <option value="box">Boxes</option>
                                  </>
                                )}
                              </select>
                            ) : (
                              <span className="self-center px-1 text-sm text-foreground">{l.unit === "box" ? "Box" : l.unit === "sqft" ? "Sq.ft" : "Nos"}</span>
                            )}
                          </div>
                          {q.error ? (
                            <span role="alert" className="text-danger">{q.error}</span>
                          ) : q.quantity !== null ? (
                            <span className="text-muted" data-testid={`equivalent-${i + 1}`}>
                              {l.unit === "piece"
                                ? `${formatQuantity(q.quantity)} nos`
                                : l.unit === "box"
                                  ? `${formatQuantity(q.quantity)} box${q.alt ? ` = ${formatQuantity(q.alt)} sq.ft` : ""}`
                                  : `${formatQuantity(q.quantity)} sq.ft${q.alt ? ` = ${formatQuantity(q.alt)} box` : ""}`}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <label className="col-span-1 flex flex-col gap-1 text-xs font-medium text-muted sm:col-span-1">
                        {l.kind === "charge" ? "Amount (₹)" : `Rate (₹/${l.unit === "sqft" ? "sq.ft" : l.unit})`}
                        <input className={small} inputMode="decimal" value={l.rate} aria-label={`Rate, line ${i + 1}`} onChange={(e) => updateLine(l.key, { rate: e.target.value })} />
                      </label>
                      {l.kind === "product" ? (
                        <label className="col-span-1 flex flex-col gap-1 text-xs font-medium text-muted sm:col-span-1">
                          Disc %
                          <input className={small} inputMode="decimal" value={l.discountPercent} aria-label={`Discount, line ${i + 1}`} onChange={(e) => updateLine(l.key, { discountPercent: e.target.value })} />
                        </label>
                      ) : null}
                      <label className="col-span-1 flex flex-col gap-1 text-xs font-medium text-muted sm:col-span-1">
                        GST %
                        <input className={small} inputMode="decimal" value={l.gstRate} aria-label={`GST rate, line ${i + 1}`} onChange={(e) => updateLine(l.key, { gstRate: e.target.value })} />
                      </label>
                      <div className="col-span-1 flex flex-col gap-1 text-xs font-medium text-muted sm:col-span-1">
                        Taxable value
                        <span className="py-1.5 text-sm tabular-nums text-foreground">{lineResult ? `₹ ${formatInr(lineResult.taxableValue.toFixed(2))}` : "–"}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button type="button" className={btn} aria-label={`Move line ${i + 1} up`} disabled={i === 0} onClick={() => moveLine(l.key, -1)}>↑</button>
                      <button type="button" className={btn} aria-label={`Move line ${i + 1} down`} disabled={i === lines.length - 1} onClick={() => moveLine(l.key, 1)}>↓</button>
                      <button type="button" className={`${btn} text-danger`} aria-label={`Remove line ${i + 1}`} onClick={() => removeLine(l.key)}>✕</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Advance, terms, notes */}
      <section className="grid gap-4 md:grid-cols-2" aria-label="Advance, terms and notes">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Advance (₹)
          <input className={inputClass} inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="0" />
          <span className="text-xs font-normal text-muted">Expected or received; the balance is shown on the quotation.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Notes (printed under the items)
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="flex flex-col gap-2 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="terms" className="text-sm font-medium">Terms and conditions</label>
            {settings.templates.length > 0 ? (
              <select
                aria-label="Terms template"
                className={`${small} w-auto`}
                value=""
                onChange={(e) => {
                  const t = settings.templates.find((x) => x.id === e.target.value);
                  if (t) setTerms(t.text);
                }}
              >
                <option value="">Use a template…</option>
                {settings.templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            ) : null}
          </div>
          <textarea id="terms" className={inputClass} rows={6} value={terms} onChange={(e) => setTerms(e.target.value)} />
          <p className="text-xs text-muted">One clause per line.</p>
        </div>
      </section>

      {/* Totals */}
      <section className="rounded-lg border border-border bg-surface p-4" aria-label="Totals" aria-live="polite">
        {totals ? (
          <dl className="ml-auto flex max-w-sm flex-col gap-1 text-sm">
            <Row label="Taxable value" value={totals.taxableTotal.toFixed(2)} />
            {mode === "intra" ? (
              <>
                <Row label="CGST" value={totals.cgstTotal.toFixed(2)} />
                <Row label="SGST" value={totals.sgstTotal.toFixed(2)} />
              </>
            ) : (
              <Row label="IGST" value={totals.igstTotal.toFixed(2)} />
            )}
            <Row label="Round off" value={totals.roundOff.toFixed(2)} signed />
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>Grand total</dt>
              <dd className="tabular-nums" data-testid="grand-total">₹ {formatInr(totals.grandTotal.toFixed(2))}</dd>
            </div>
            <p className="text-right text-xs text-muted" data-testid="total-in-words">{totals.totalInWords}</p>
            {totals.advance.gt(0) ? (
              <>
                <Row label="Advance" value={totals.advance.toFixed(2)} />
                <Row label="Balance" value={totals.balance.toFixed(2)} />
              </>
            ) : null}
          </dl>
        ) : (
          <p className="text-sm text-muted">Choose a customer and complete the items (quantity, rate and GST for each) to see the totals.</p>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={`${btn} px-4 py-2`}>
          {pending ? "Working…" : "Save draft"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(true)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {isRevision ? "Issue revision" : "Issue quotation"}
        </button>
      </div>
      <p className="-mt-4 text-xs text-muted">
        {isRevision
          ? "Issuing keeps the quotation number; the earlier revision stays viewable."
          : "Issuing assigns the quotation number and freezes the figures. A draft has no number."}
      </p>
    </form>
  );
}

function Row({ label, value, signed = false }: { label: string; value: string; signed?: boolean }) {
  const shown = signed && Number(value) > 0 ? `+${formatInr(value)}` : formatInr(value);
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">₹ {shown}</dd>
    </div>
  );
}
