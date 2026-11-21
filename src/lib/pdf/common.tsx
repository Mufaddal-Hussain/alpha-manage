/* eslint-disable jsx-a11y/alt-text -- react-pdf's <Image> draws into the PDF; it has no alt attribute */
import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import { FONT, FONT_BOLD } from "@/lib/pdf/fonts";
import type { PdfBranding } from "@/lib/pdf/quotation-data";

// Pieces shared by the quotation PDF layouts. A4 portrait, 11 pt margins are set by the page itself.

export const colors = { ink: "#1c1917", muted: "#57534e", rule: "#a8a29e", faint: "#e7e5e4", accent: "#9a3412" };

export const base = StyleSheet.create({
  page: { fontFamily: FONT, fontSize: 9, color: colors.ink, paddingTop: 28, paddingBottom: 64, paddingHorizontal: 30, lineHeight: 1.35 },
  bold: { fontFamily: FONT_BOLD },
  muted: { color: colors.muted },
  small: { fontSize: 8 },
  row: { flexDirection: "row" },
  right: { textAlign: "right" },
  rule: { borderBottomWidth: 0.75, borderBottomColor: colors.rule },
});

/** Business block: logo, name, address, contact and GSTIN, from the business profile. */
export function BusinessHeader({ data }: { data: PdfBranding }) {
  const b = data.business;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", flexGrow: 1 }}>
      {data.logo ? <Image src={{ data: data.logo.data, format: data.logo.format }} style={{ width: 56, height: 56, objectFit: "contain", marginRight: 10 }} /> : null}
      <View style={{ flexShrink: 1 }}>
        <Text style={[base.bold, { fontSize: 15, lineHeight: 1.1, marginBottom: 3 }]}>{b.name}</Text>
        {b.addressLines.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
        {b.phone || b.email ? <Text>{[b.phone ? `Phone: ${b.phone}` : null, b.email ? `Email: ${b.email}` : null].filter(Boolean).join("   ")}</Text> : null}
        {b.gstin ? <Text>GSTIN: {b.gstin}</Text> : null}
        <Text>
          State: {b.state}, Code: {b.stateCode}
        </Text>
      </View>
    </View>
  );
}

/**
 * Brand strip (the logos of the brands the business sells) at the end of the document. It sits in the normal flow after
 * the signature block. Page numbers are left out on purpose: react-pdf draws a `render` Text with the bundled font as
 * blank, and a quotation is normally one page.
 */
export function PageFooter({ data }: { data: PdfBranding }) {
  if (!data.brandStrip) return null;
  return (
    <View wrap={false} style={{ marginTop: 16 }}>
      <Image src={{ data: data.brandStrip.data, format: data.brandStrip.format }} style={{ width: "100%", maxHeight: 34, objectFit: "contain" }} />
    </View>
  );
}

/** Diagonal DRAFT mark for revisions that have not been issued. */
export function DraftWatermark() {
  return (
    <View fixed style={{ position: "absolute", top: 300, left: 60, right: 60, alignItems: "center" }}>
      <Text style={{ fontFamily: FONT_BOLD, fontSize: 110, color: "#d6d3d1", opacity: 0.45, transform: "rotate(-30deg)" }}>DRAFT</Text>
    </View>
  );
}

/** The terms text, one numbered clause per line. */
export function Terms({ text }: { text: string | null }) {
  const clauses = (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (clauses.length === 0) return null;
  return (
    <View wrap={false} style={{ marginTop: 10 }}>
      <Text style={[base.bold, { marginBottom: 2 }]}>Terms and Conditions</Text>
      {clauses.map((clause, i) => (
        <Text key={i} style={base.small}>
          {i + 1}. {clause}
        </Text>
      ))}
    </View>
  );
}

/** "for {business}" with room to sign. */
export function SignatureBlock({ data, receiver = false }: { data: PdfBranding; receiver?: boolean }) {
  return (
    <View wrap={false} style={{ flexDirection: "row", justifyContent: receiver ? "space-between" : "flex-end", marginTop: 18 }}>
      {receiver ? (
        <View style={{ width: 170 }}>
          <View style={{ height: 40 }} />
          <Text style={[base.rule, { borderTopWidth: 0.75, borderTopColor: colors.rule, paddingTop: 2, borderBottomWidth: 0 }]}>Receiver&apos;s sign</Text>
        </View>
      ) : null}
      <View style={{ width: 170 }}>
        <Text style={{ textAlign: "right" }}>for {data.business.name}</Text>
        <View style={{ height: 40 }} />
        <Text style={{ textAlign: "right", borderTopWidth: 0.75, borderTopColor: colors.rule, paddingTop: 2 }}>Authorised signatory</Text>
      </View>
    </View>
  );
}
