import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { amountInWords } from "@/lib/amount-in-words";
import { formatDate, formatInr, formatQuantity, UNIT_LABELS } from "@/lib/format";
import { getStateByCode } from "@/lib/gst/state-codes";
import { add } from "@/lib/money";
import { computeQuotation } from "@/lib/quotation/calc";
import { istDate } from "@/lib/quotation/status";
import { base, colors, PageFooter } from "@/lib/pdf/common";
import type { ChallanPdfData } from "@/lib/pdf/challan-data";
import { FONT_BOLD } from "@/lib/pdf/fonts";

// Delivery challan layout (contracts/document-layouts.md section 3, the Tally delivery note). Quantities, descriptions
// and (when printed) rates come from the challan's own snapshot lines. Rates, tax and totals appear only when
// `showPrices` is true; the quantity-only variant is the normal one for a delivery note.

const s = StyleSheet.create({
  box: { borderWidth: 0.75, borderColor: colors.rule },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  th: { fontFamily: FONT_BOLD, fontSize: 8, backgroundColor: colors.faint },
  label: { fontFamily: FONT_BOLD, fontSize: 7, color: colors.muted, textTransform: "uppercase", marginBottom: 1 },
});

const stateLine = (code: string) => `${getStateByCode(code)?.name ?? code}, Code: ${code}`;
const fileSafe = (v: string) => v.replace(/[^A-Za-z0-9._-]+/g, "-");
export const challanFileName = (number: string) => `${fileSafe(number)}.pdf`;

function Cell({ w, children, right = false, head = false }: { w: string; children?: React.ReactNode; right?: boolean; head?: boolean }) {
  return <View style={[s.cell, head ? s.th : {}, { width: w }]}>{typeof children === "string" || typeof children === "number" ? <Text style={right ? base.right : undefined}>{children}</Text> : children}</View>;
}

/** One cell of the reference grid on the right of the header: small label over the value. */
function Ref({ label, value, last = false, bottom = true }: { label: string; value: string | null | undefined; last?: boolean; bottom?: boolean }) {
  return (
    <View style={{ flexBasis: 0, flexGrow: 1, padding: 4, minHeight: 30, borderRightWidth: last ? 0 : 0.75, borderRightColor: colors.rule, borderBottomWidth: bottom ? 0.75 : 0, borderBottomColor: colors.rule }}>
      <Text style={s.label}>{label}</Text>
      <Text>{value || " "}</Text>
    </View>
  );
}

function Party({ title, name, address, gstin, stateCode, last = false }: { title: string; name: string; address: string | null; gstin: string | null; stateCode: string; last?: boolean }) {
  return (
    <View style={{ padding: 4, borderBottomWidth: last ? 0 : 0.75, borderBottomColor: colors.rule }}>
      <Text style={s.label}>{title}</Text>
      <Text style={base.bold}>{name}</Text>
      {address ? <Text>{address}</Text> : null}
      {gstin ? <Text>GSTIN/UIN: {gstin}</Text> : null}
      <Text>State Name: {stateLine(stateCode)}</Text>
    </View>
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

/** "100 Box, 10 Nos": the quantities added up per unit (boxes and pieces cannot be added together). */
function totalQuantity(lines: ChallanPdfData["lines"]): string {
  const byUnit = new Map<string, string>();
  for (const l of lines) byUnit.set(l.unit, add(byUnit.get(l.unit) ?? 0, l.quantity).toFixed(3));
  return [...byUnit].map(([unit, qty]) => `${formatQuantity(qty)} ${UNIT_LABELS[unit as keyof typeof UNIT_LABELS]}`).join(", ");
}

/** Diagonal CANCELLED mark over the whole page. The reason is printed under the title, not here. */
function Cancelled() {
  return (
    <View fixed style={{ position: "absolute", top: 330, left: 0, right: 0, alignItems: "center" }}>
      <Text style={{ fontFamily: FONT_BOLD, fontSize: 80, color: "#dc2626", opacity: 0.28, transform: "rotate(-30deg)" }}>CANCELLED</Text>
    </View>
  );
}

export function ChallanDocument({ data, showPrices }: { data: ChallanPdfData; showPrices: boolean }) {
  const c = data.challan;
  const b = data.business;
  const cancelled = c.status === "cancelled";
  const intra = c.taxMode === "intra";

  const totals = showPrices
    ? computeQuotation(
        data.lines.map((l) => ({ kind: "product" as const, quantity: l.quantity, rate: l.rate, discountPercent: l.discountPercent, gstRate: l.gstRate, hsnCode: l.hsnCode })),
        c.taxMode,
      )
    : null;

  // Column widths: the quantity-only variant gives the description the room the price columns would use.
  const W = showPrices
    ? { sl: "5%", desc: "33%", hsn: "10%", qty: "14%", rate: "12%", per: "6%", disc: "7%", amount: "13%" }
    : { sl: "6%", desc: "52%", hsn: "14%", qty: "28%" };

  return (
    <Document title={`Delivery challan ${c.number}`} author={b.name}>
      <Page size="A4" style={base.page}>
        {cancelled ? <Cancelled /> : null}

        <Text style={[base.bold, { fontSize: 13, textAlign: "center", marginBottom: 2 }]}>DELIVERY NOTE / DELIVERY CHALLAN</Text>
        {cancelled ? (
          <Text style={[base.bold, { textAlign: "center", color: "#b91c1c", marginBottom: 4 }]}>
            CANCELLED{c.cancelledAt ? ` on ${formatDate(istDate(c.cancelledAt))}` : ""}
            {c.cancelReason ? `: ${c.cancelReason}` : ""}
          </Text>
        ) : (
          <View style={{ height: 4 }} />
        )}

        {/* Header: parties on the left, reference grid on the right */}
        <View style={[s.box, { flexDirection: "row" }]}>
          <View style={{ width: "50%", borderRightWidth: 0.75, borderRightColor: colors.rule }}>
            <View style={{ padding: 4, borderBottomWidth: 0.75, borderBottomColor: colors.rule }}>
              <Text style={[base.bold, { fontSize: 12, lineHeight: 1.1, marginBottom: 2 }]}>{b.name}</Text>
              {b.addressLines.map((line) => (
                <Text key={line}>{line}</Text>
              ))}
              {b.gstin ? <Text>GSTIN/UIN: {b.gstin}</Text> : null}
              <Text>State Name: {stateLine(b.stateCode)}</Text>
              {b.email ? <Text>E-Mail: {b.email}</Text> : null}
            </View>
            <Party title="Consignee (Ship to)" name={c.consigneeName} address={c.consigneeAddress} gstin={c.consigneeGstin} stateCode={c.consigneeStateCode} />
            <Party title="Buyer (Bill to)" name={c.buyerName} address={c.buyerAddress} gstin={c.buyerGstin} stateCode={c.buyerStateCode} last />
          </View>
          <View style={{ width: "50%" }}>
            <View style={{ flexDirection: "row" }}>
              <Ref label="Delivery Note No." value={c.number} />
              <Ref label="Dated" value={formatDate(c.challanDate)} last />
            </View>
            <View style={{ flexDirection: "row" }}>
              <Ref label="Mode/Terms of Payment" value={c.modeTermsOfPayment} />
              <Ref label="Reference No. & Date" value={c.referenceNoDate} last />
            </View>
            <View style={{ flexDirection: "row" }}>
              <Ref label="Other References" value={c.otherReferences} />
              <Ref label="Buyer's Order No. & Date" value={c.buyersOrderNoDate} last />
            </View>
            <View style={{ flexDirection: "row" }}>
              <Ref label="Dispatch Doc No." value={c.dispatchDocNo} />
              <Ref label="Dispatched through" value={c.dispatchedThrough} last />
            </View>
            <View style={{ flexDirection: "row", flexGrow: 1 }}>
              <Ref label="Destination" value={c.destination} bottom={false} />
              <Ref label="Terms of Delivery" value={c.termsOfDelivery} last bottom={false} />
            </View>
          </View>
        </View>

        {/* Vehicle and driver */}
        <View style={[s.box, { flexDirection: "row", marginTop: -0.75 }]}>
          <Ref label="Vehicle No." value={c.vehicleNo} bottom={false} />
          <Ref label="Driver name" value={c.driverName} bottom={false} />
          <Ref label="Driver phone" value={c.driverPhone} last bottom={false} />
        </View>

        {/* Items */}
        <View style={[s.box, { marginTop: 8 }]}>
          <View style={{ flexDirection: "row" }} fixed>
            <Cell w={W.sl} head>Sl</Cell>
            <Cell w={W.desc} head>Description of Goods</Cell>
            <Cell w={W.hsn} head>HSN/SAC</Cell>
            <Cell w={W.qty} head right>Quantity</Cell>
            {showPrices ? (
              <>
                <Cell w={W.rate!} head right>Rate</Cell>
                <Cell w={W.per!} head>per</Cell>
                <Cell w={W.disc!} head right>Disc %</Cell>
                <Cell w={W.amount!} head right>Amount</Cell>
              </>
            ) : null}
          </View>
          {data.lines.map((l, i) => (
            <View key={l.id} wrap={false} style={{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: colors.faint }}>
              <Cell w={W.sl}>{l.lineNo}</Cell>
              <Cell w={W.desc}>{l.description}</Cell>
              <Cell w={W.hsn}>{l.hsnCode}</Cell>
              <Cell w={W.qty} right>
                {`${formatQuantity(l.quantity)} ${UNIT_LABELS[l.unit]}`}
              </Cell>
              {showPrices ? (
                <>
                  <Cell w={W.rate!} right>{formatInr(l.rate)}</Cell>
                  <Cell w={W.per!}>{UNIT_LABELS[l.unit]}</Cell>
                  <Cell w={W.disc!} right>{Number(l.discountPercent) === 0 ? "" : formatQuantity(l.discountPercent)}</Cell>
                  <Cell w={W.amount!} right>{formatInr(totals!.lines[i].taxableValue.toFixed(2))}</Cell>
                </>
              ) : null}
            </View>
          ))}
          <View wrap={false} style={{ flexDirection: "row", borderTopWidth: 0.75, borderTopColor: colors.rule }}>
            <Cell w={W.sl} />
            <Cell w={W.desc}>
              <Text style={[base.bold, base.right]}>Total</Text>
            </Cell>
            <Cell w={W.hsn} />
            <Cell w={W.qty} right>
              <Text style={[base.bold, base.right]}>{totalQuantity(data.lines)}</Text>
            </Cell>
            {showPrices ? (
              <>
                <Cell w={W.rate!} />
                <Cell w={W.per!} />
                <Cell w={W.disc!} />
                <Cell w={W.amount!} right>{formatInr(totals!.taxableTotal.toFixed(2))}</Cell>
              </>
            ) : null}
          </View>
        </View>

        {/* Prices shown: tax, round-off, total, words and the HSN-wise summary */}
        {totals ? (
          <>
            <View wrap={false} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, gap: 12 }}>
              <View style={{ flexGrow: 1, flexBasis: 0 }}>
                <Text style={base.bold}>Amount chargeable (in words)</Text>
                <Text>{totals.totalInWords || amountInWords(totals.grandTotal)}</Text>
              </View>
              <View style={{ width: 200 }}>
                <TotalRow label="Taxable value" value={totals.taxableTotal.toFixed(2)} />
                {intra ? (
                  <>
                    <TotalRow label="CGST" value={totals.cgstTotal.toFixed(2)} />
                    <TotalRow label="SGST" value={totals.sgstTotal.toFixed(2)} />
                  </>
                ) : (
                  <TotalRow label="IGST" value={totals.igstTotal.toFixed(2)} />
                )}
                <TotalRow label="Round off" value={totals.roundOff.toFixed(2)} signed />
                <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.75, borderTopColor: colors.ink, borderBottomWidth: 0.75, borderBottomColor: colors.ink, paddingVertical: 3, marginTop: 2 }}>
                  <Text style={[base.bold, { fontSize: 11 }]}>Total</Text>
                  <Text style={{ fontSize: 12 }}>₹ {formatInr(totals.grandTotal.toFixed(2))}</Text>
                </View>
              </View>
            </View>

            <View wrap={false} style={{ marginTop: 10 }}>
              <Text style={[base.bold, { marginBottom: 2 }]}>HSN-wise tax summary</Text>
              <View style={s.box}>
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
                {totals.hsnSummary.map((row) => (
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
          </>
        ) : null}

        {/* Receiver block and authorised signatory */}
        <View wrap={false} style={{ marginTop: 18, flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
          <View style={[s.box, { width: "55%", padding: 6 }]}>
            <Text style={base.bold}>Received in good condition</Text>
            <View style={{ flexDirection: "row", marginTop: 22, gap: 10 }}>
              {["Receiver's name", "Signature", "Date"].map((label) => (
                <View key={label} style={{ flexGrow: 1, flexBasis: 0, borderTopWidth: 0.75, borderTopColor: colors.rule, paddingTop: 2 }}>
                  <Text style={[base.small, base.muted]}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={{ width: 170, justifyContent: "space-between" }}>
            <Text style={{ textAlign: "right" }}>for {b.name}</Text>
            <View style={{ height: 40 }} />
            <Text style={{ textAlign: "right", borderTopWidth: 0.75, borderTopColor: colors.rule, paddingTop: 2 }}>Authorised signatory</Text>
          </View>
        </View>

        <Text style={[base.small, base.muted, { textAlign: "center", marginTop: 14 }]}>This is a computer generated document</Text>
        <PageFooter data={data} />
      </Page>
    </Document>
  );
}
