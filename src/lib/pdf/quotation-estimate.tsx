import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate, formatInr, formatQuantity, UNIT_LABELS } from "@/lib/format";
import { base, BusinessHeader, colors, DraftWatermark, PageFooter, SignatureBlock, Terms } from "@/lib/pdf/common";
import { FONT_BOLD } from "@/lib/pdf/fonts";
import type { QuotationPdfData } from "@/lib/pdf/quotation-data";

// Estimate layout (contracts/document-layouts.md §2): the customer-friendly sheet modelled on the
// "Delivery Challan / Estimate" the business uses today. Same data as the quotation, simpler presentation:
// Sl, item, qty, rate and total per line; sub total, one GST line, advance and the total in rupees.

const COLS = { sl: "7%", desc: "43%", qty: "17%", rate: "15%", total: "18%" };

const s = StyleSheet.create({
  cell: { paddingVertical: 4, paddingHorizontal: 4 },
  th: { fontFamily: FONT_BOLD, fontSize: 9, backgroundColor: colors.faint },
  label: { fontFamily: FONT_BOLD, fontSize: 8, color: colors.muted, textTransform: "uppercase", marginBottom: 2 },
});

function Cell({ w, children, right = false, head = false }: { w: string; children?: React.ReactNode; right?: boolean; head?: boolean }) {
  return <View style={[s.cell, head ? s.th : {}, { width: w }]}>{typeof children === "string" || typeof children === "number" ? <Text style={right ? base.right : undefined}>{children}</Text> : children}</View>;
}

export function QuotationEstimateDocument({ data }: { data: QuotationPdfData }) {
  const r = data.revision;
  const advance = Number(r.advanceAmount);
  const tax = Number(r.cgstTotal) + Number(r.sgstTotal) + Number(r.igstTotal);
  const roundOff = Number(r.roundOff);
  const shipAddress = r.shipToAddress ?? r.billToAddress;

  return (
    <Document title={`Estimate ${data.number ?? "(draft)"}`} author={data.business.name}>
      <Page size="A4" style={base.page}>
        {data.draft ? <DraftWatermark /> : null}

        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <BusinessHeader data={data} />
          <View style={{ width: 150 }}>
            <Text style={[base.bold, { fontSize: 18, lineHeight: 1, marginBottom: 5, textAlign: "right", color: colors.accent }]}>ESTIMATE</Text>
            <Text style={[base.bold, base.right, { fontSize: 11, marginBottom: 2 }]}>
              {data.number ?? "DRAFT"}
              {r.revisionNo > 1 ? `  (Rev ${r.revisionNo})` : ""}
            </Text>
            <Text style={base.right}>Date: {formatDate(r.quotationDate)}</Text>
            <Text style={base.right}>Valid until: {formatDate(r.validUntil)}</Text>
          </View>
        </View>

        <View style={[base.rule, { marginVertical: 8 }]} />

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={s.label}>Estimate to</Text>
            <Text style={[base.bold, { fontSize: 11 }]}>{r.billToName}</Text>
            {r.billToAddress ? <Text>{r.billToAddress}</Text> : null}
            {r.billToGstin ? <Text>GSTIN: {r.billToGstin}</Text> : null}
          </View>
          {shipAddress && (r.shipToAddress || r.siteContactName) ? (
            <View style={{ flexGrow: 1, flexBasis: 0 }}>
              <Text style={s.label}>Delivery address</Text>
              <Text>{shipAddress}</Text>
              {r.siteContactName || r.siteContactPhone ? <Text>Contact: {[r.siteContactName, r.siteContactPhone].filter(Boolean).join(", ")}</Text> : null}
            </View>
          ) : null}
        </View>

        <View style={{ marginTop: 12, borderWidth: 0.75, borderColor: colors.rule }}>
          <View style={{ flexDirection: "row" }} fixed>
            <Cell w={COLS.sl} head>SL</Cell>
            <Cell w={COLS.desc} head>ITEM DESCRIPTION</Cell>
            <Cell w={COLS.qty} head right>QTY</Cell>
            <Cell w={COLS.rate} head right>RATE</Cell>
            <Cell w={COLS.total} head right>TOTAL</Cell>
          </View>
          {data.lines.map((l) => (
            <View key={l.id} wrap={false} style={{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: colors.faint }}>
              <Cell w={COLS.sl}>{l.lineNo}</Cell>
              <Cell w={COLS.desc}>{l.description}</Cell>
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
              <Cell w={COLS.total} right>{formatInr(l.taxableValue)}</Cell>
            </View>
          ))}
        </View>

        {r.notes ? <Text style={[base.small, { marginTop: 6 }]}>Note: {r.notes}</Text> : null}

        <View wrap={false} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, gap: 12 }}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={base.bold}>Amount in words</Text>
            <Text>{r.totalInWords}</Text>
          </View>
          <View style={{ width: 210 }}>
            <Line label="SUB TOTAL" value={`₹ ${formatInr(r.subtotal)}`} />
            {tax > 0 ? <Line label={r.taxMode === "intra" ? "GST (CGST + SGST)" : "GST (IGST)"} value={`₹ ${formatInr(tax.toFixed(2))}`} /> : null}
            {roundOff !== 0 ? <Line label="Round off" value={`₹ ${roundOff > 0 ? "+" : ""}${formatInr(r.roundOff)}`} /> : null}
            <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.75, borderTopColor: colors.ink, borderBottomWidth: 0.75, borderBottomColor: colors.ink, paddingVertical: 3, marginTop: 2 }}>
              <Text style={{ fontSize: 11 }}>TOTAL ₹</Text>
              <Text style={{ fontSize: 12 }}>₹ {formatInr(r.grandTotal)}</Text>
            </View>
            {advance > 0 ? (
              <>
                <Line label="ADVANCE" value={`₹ ${formatInr(r.advanceAmount)}`} />
                <Line label="BALANCE DUE" value={`₹ ${formatInr((Number(r.grandTotal) - advance).toFixed(2))}`} />
              </>
            ) : null}
          </View>
        </View>

        <Terms text={r.termsText} />
        <SignatureBlock data={data} receiver />
        <PageFooter data={data} />
      </Page>
    </Document>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 }}>
      <Text style={base.muted}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}
