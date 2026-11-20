import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate, formatInr, formatQuantity, UNIT_LABELS } from "@/lib/format";
import { getStateByCode } from "@/lib/gst/state-codes";
import { computeQuotation } from "@/lib/quotation/calc";
import { base, BusinessHeader, colors, DraftWatermark, PageFooter, SignatureBlock, Terms } from "@/lib/pdf/common";
import { FONT_BOLD } from "@/lib/pdf/fonts";
import type { QuotationPdfData } from "@/lib/pdf/quotation-data";

// GST quotation layout (contracts/document-layouts.md §1). Figures come from the stored (frozen) lines and
// revision totals; only the HSN-wise summary is derived, with the same engine the quotation was priced with.

const COLS = { sl: "4%", desc: "27%", hsn: "9%", qty: "13%", rate: "10%", disc: "6%", taxable: "12%", gst: "6%", amount: "13%" };

const s = StyleSheet.create({
  cell: { paddingVertical: 3, paddingHorizontal: 3 },
  th: { fontFamily: FONT_BOLD, fontSize: 8, backgroundColor: colors.faint },
  box: { borderWidth: 0.75, borderColor: colors.rule, padding: 6, flexGrow: 1, flexBasis: 0 },
  label: { fontFamily: FONT_BOLD, fontSize: 8, color: colors.muted, textTransform: "uppercase", marginBottom: 2 },
});

const stateLine = (code: string | null) => (code ? `${getStateByCode(code)?.name ?? code} (${code})` : "");
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
export const quotationFileName = (number: string | null, revisionNo: number) => `${number ? fileSafe(number) : "draft"}-rev${revisionNo}.pdf`;

function Cell({ w, children, right = false, head = false }: { w: string; children?: React.ReactNode; right?: boolean; head?: boolean }) {
  return <View style={[s.cell, head ? s.th : {}, { width: w }]}>{typeof children === "string" || typeof children === "number" ? <Text style={right ? base.right : undefined}>{children}</Text> : children}</View>;
}

export function QuotationGstDocument({ data }: { data: QuotationPdfData }) {
  const r = data.revision;
  const intra = r.taxMode === "intra";
  const summary = computeQuotation(
    data.lines.map((l) => ({ kind: l.kind, quantity: l.quantity, rate: l.rate, discountPercent: l.discountPercent, gstRate: l.gstRate, hsnCode: l.hsnCode })),
    r.taxMode,
    { advance: r.advanceAmount },
  ).hsnSummary;
  const advance = Number(r.advanceAmount);
  const shipAddress = r.shipToAddress ?? r.billToAddress;

  return (
    <Document title={`Quotation ${data.number ?? "(draft)"}`} author={data.business.name}>
      <Page size="A4" style={base.page}>
        {data.draft ? <DraftWatermark /> : null}

        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <BusinessHeader data={data} />
          <View style={{ width: 150 }}>
            <Text style={[base.bold, { fontSize: 18, lineHeight: 1, marginBottom: 5, textAlign: "right", color: colors.accent }]}>QUOTATION</Text>
            <Text style={[base.bold, base.right, { fontSize: 11, marginBottom: 2 }]}>
              {data.number ?? "DRAFT"}
              {r.revisionNo > 1 ? `  (Rev ${r.revisionNo})` : ""}
            </Text>
            <Text style={base.right}>Date: {formatDate(r.quotationDate)}</Text>
            <Text style={base.right}>Valid until: {formatDate(r.validUntil)}</Text>
          </View>
        </View>

        <View style={[base.rule, { marginVertical: 8 }]} />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={s.box}>
            <Text style={s.label}>Bill to</Text>
            <Text style={base.bold}>{r.billToName}</Text>
            {r.billToAddress ? <Text>{r.billToAddress}</Text> : null}
            {r.billToGstin ? <Text>GSTIN: {r.billToGstin}</Text> : null}
            <Text>State: {stateLine(r.billToStateCode)}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Ship to / site</Text>
            {shipAddress ? <Text>{shipAddress}</Text> : null}
            <Text>State: {stateLine(r.placeOfSupplyStateCode)}</Text>
            {r.siteContactName || r.siteContactPhone ? (
              <Text>Contact: {[r.siteContactName, r.siteContactPhone].filter(Boolean).join(", ")}</Text>
            ) : null}
          </View>
        </View>

        {/* Items */}
        <View style={{ marginTop: 10, borderWidth: 0.75, borderColor: colors.rule }}>
          <View style={{ flexDirection: "row" }} fixed>
            <Cell w={COLS.sl} head>Sl</Cell>
            <Cell w={COLS.desc} head>Description</Cell>
            <Cell w={COLS.hsn} head>HSN/SAC</Cell>
            <Cell w={COLS.qty} head right>Qty</Cell>
            <Cell w={COLS.rate} head right>Rate</Cell>
            <Cell w={COLS.disc} head right>Disc %</Cell>
            <Cell w={COLS.taxable} head right>Taxable value</Cell>
            <Cell w={COLS.gst} head right>GST %</Cell>
            <Cell w={COLS.amount} head right>Amount</Cell>
          </View>
          {data.lines.map((l) => (
            <View key={l.id} wrap={false} style={[{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: colors.faint }]}>
              <Cell w={COLS.sl}>{l.lineNo}</Cell>
              <Cell w={COLS.desc}>{l.description}</Cell>
              <Cell w={COLS.hsn}>{l.hsnCode}</Cell>
              <Cell w={COLS.qty} right>
                {l.kind === "charge" ? (
                  <Text> </Text>
                ) : (
                  <View>
                    <Text style={base.right}>
                      {formatQuantity(l.quantity)} {UNIT_LABELS[l.unit]}
                    </Text>
                    {l.quantityAlt && l.unit !== "piece" ? (
                      <Text style={[base.right, base.small, base.muted]}>
                        ({formatQuantity(l.quantityAlt)} {l.unit === "box" ? "sq.ft" : "box"})
                      </Text>
                    ) : null}
                  </View>
                )}
              </Cell>
              <Cell w={COLS.rate} right>{formatInr(l.rate)}</Cell>
              <Cell w={COLS.disc} right>{l.kind === "charge" || Number(l.discountPercent) === 0 ? "" : formatQuantity(l.discountPercent)}</Cell>
              <Cell w={COLS.taxable} right>{formatInr(l.taxableValue)}</Cell>
              <Cell w={COLS.gst} right>{formatQuantity(l.gstRate)}</Cell>
              <Cell w={COLS.amount} right>{formatInr(l.lineTotal)}</Cell>
            </View>
          ))}
        </View>

        {r.notes ? <Text style={[base.small, { marginTop: 6 }]}>Note: {r.notes}</Text> : null}

        {/* Totals */}
        <View wrap={false} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, gap: 12 }}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={base.bold}>Amount in words</Text>
            <Text>{r.totalInWords}</Text>
            {data.business.bankName || data.business.bankAccountNo ? (
              <View style={{ marginTop: 8 }}>
                <Text style={base.bold}>Bank details</Text>
                {data.business.bankName ? <Text>Bank: {data.business.bankName}</Text> : null}
                {data.business.bankAccountNo ? <Text>A/c No.: {data.business.bankAccountNo}</Text> : null}
                {data.business.bankIfsc ? <Text>IFSC: {data.business.bankIfsc}</Text> : null}
              </View>
            ) : null}
          </View>
          <View style={{ width: 200 }}>
            <TotalRow label="Taxable value" value={r.subtotal} />
            {intra ? (
              <>
                <TotalRow label="CGST" value={r.cgstTotal} />
                <TotalRow label="SGST" value={r.sgstTotal} />
              </>
            ) : (
              <TotalRow label="IGST" value={r.igstTotal} />
            )}
            <TotalRow label="Round off" value={r.roundOff} signed />
            <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.75, borderTopColor: colors.ink, borderBottomWidth: 0.75, borderBottomColor: colors.ink, paddingVertical: 3, marginTop: 2 }}>
              <Text style={[base.bold, { fontSize: 11 }]}>Grand total</Text>
              <Text style={{ fontSize: 12 }}>₹ {formatInr(r.grandTotal)}</Text>
            </View>
            {advance > 0 ? (
              <>
                <TotalRow label="Advance" value={r.advanceAmount} />
                <TotalRow label="Balance" value={(Number(r.grandTotal) - advance).toFixed(2)} />
              </>
            ) : null}
          </View>
        </View>

        {/* HSN-wise summary */}
        <View wrap={false} style={{ marginTop: 12 }}>
          <Text style={[base.bold, { marginBottom: 2 }]}>HSN-wise tax summary</Text>
          <View style={{ borderWidth: 0.75, borderColor: colors.rule }}>
            <View style={{ flexDirection: "row" }}>
              <Cell w="22%" head>HSN/SAC</Cell>
              <Cell w="22%" head right>Taxable value</Cell>
              <Cell w="10%" head right>Rate %</Cell>
              {intra ? (
                <>
                  <Cell w="23%" head right>CGST</Cell>
                  <Cell w="23%" head right>SGST</Cell>
                </>
              ) : (
                <Cell w="46%" head right>IGST</Cell>
              )}
            </View>
            {summary.map((row) => (
              <View key={`${row.hsnCode}|${row.gstRate}`} style={{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: colors.faint }}>
                <Cell w="22%">{row.hsnCode || "-"}</Cell>
                <Cell w="22%" right>{formatInr(row.taxableValue.toFixed(2))}</Cell>
                <Cell w="10%" right>{formatQuantity(row.gstRate)}</Cell>
                {intra ? (
                  <>
                    <Cell w="23%" right>{formatInr(row.cgst.toFixed(2))}</Cell>
                    <Cell w="23%" right>{formatInr(row.sgst.toFixed(2))}</Cell>
                  </>
                ) : (
                  <Cell w="46%" right>{formatInr(row.igst.toFixed(2))}</Cell>
                )}
              </View>
            ))}
          </View>
        </View>

        <Terms text={r.termsText} />
        <SignatureBlock data={data} />
        <PageFooter data={data} />
      </Page>
    </Document>
  );
}

function TotalRow({ label, value, signed = false }: { label: string; value: string; signed?: boolean }) {
  const shown = signed && Number(value) > 0 ? `+${formatInr(value)}` : formatInr(value);
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 }}>
      <Text style={base.muted}>{label}</Text>
      <Text>₹ {shown}</Text>
    </View>
  );
}
