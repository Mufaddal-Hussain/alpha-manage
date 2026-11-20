import type { QuotationLine, QuotationRevision } from "@/db/schema";

// Shapes shared by the quotation editor (client) and the pages that load a draft into it (server).
// Plain serialisable data only.

export interface EditorLine {
  /** Stable key for React; not stored. */
  key: string;
  kind: "product" | "charge";
  productId: string | null;
  chargeTypeId: string | null;
  description: string;
  hsnCode: string;
  unit: "box" | "sqft" | "piece";
  piecesPerBox: number | null;
  sqftPerBox: string | null;
  /** What the person types; `enteredIn` says whether it counts boxes or sq.ft. */
  entered: string;
  enteredIn: "box" | "sqft" | "piece";
  rate: string;
  discountPercent: string;
  gstRate: string;
}

export interface EditorInitial {
  quotationId: string | null;
  number: string | null;
  revisionNo: number;
  customer: { id: string; displayName: string } | null;
  quotationDate: string;
  validUntil: string;
  billTo: { name: string; gstin: string; address: string; stateCode: string };
  shipTo: { address: string; stateCode: string; contactName: string; contactPhone: string; sameAsBillTo: boolean };
  layout: "gst_quotation" | "estimate";
  terms: string;
  advanceAmount: string;
  notes: string;
  lines: EditorLine[];
}

const trim = (n: string | number) => String(Number(n));

/** Loads a stored revision into editor form (used to edit a draft and to start a revision). */
export function initialFromRevision(args: {
  quotationId: string;
  number: string | null;
  customer: { id: string; displayName: string };
  revision: QuotationRevision;
  lines: QuotationLine[];
}): EditorInitial {
  const { revision: r } = args;
  const sameAsBillTo = !r.shipToAddress && (r.shipToStateCode === null || r.shipToStateCode === r.billToStateCode);
  return {
    quotationId: args.quotationId,
    number: args.number,
    revisionNo: r.revisionNo,
    customer: args.customer,
    quotationDate: r.quotationDate,
    validUntil: r.validUntil,
    billTo: { name: r.billToName, gstin: r.billToGstin ?? "", address: r.billToAddress ?? "", stateCode: r.billToStateCode },
    shipTo: {
      address: r.shipToAddress ?? "",
      stateCode: r.shipToStateCode ?? r.billToStateCode,
      contactName: r.siteContactName ?? "",
      contactPhone: r.siteContactPhone ?? "",
      sameAsBillTo,
    },
    layout: r.layout,
    terms: r.termsText ?? "",
    advanceAmount: trim(r.advanceAmount) === "0" ? "" : trim(r.advanceAmount),
    notes: r.notes ?? "",
    lines: args.lines.map((l) => ({
      key: l.id,
      kind: l.kind,
      productId: l.productId,
      chargeTypeId: l.chargeTypeId,
      description: l.description,
      hsnCode: l.hsnCode,
      unit: l.unit,
      piecesPerBox: l.piecesPerBox,
      sqftPerBox: l.sqftPerBox === null ? null : trim(l.sqftPerBox),
      entered: trim(l.quantity),
      enteredIn: l.unit,
      rate: trim(l.rate),
      discountPercent: trim(l.discountPercent),
      gstRate: trim(l.gstRate),
    })),
  };
}
