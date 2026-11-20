// Builds the Excel/CSV price-list fixtures from rows typed in from the two sample PDFs in samples/ (T052).
// Run with: npx tsx tests/fixtures/price-lists/build-fixtures.ts
// The generated files are committed; this script is only here so they can be regenerated and reviewed.
import path from "node:path";
import ExcelJS from "exceljs";

const COLUMNS = [
  "brand",
  "list_label",
  "effective_from",
  "size",
  "pieces_per_box",
  "sqft_per_box",
  "finish",
  "rate_per_box",
  "rate_per_sqft",
  "designs",
  "hsn_code",
] as const;

type Row = Record<(typeof COLUMNS)[number], string | number | Date | null>;

function row(r: Partial<Row> & Pick<Row, "brand" | "effective_from" | "size" | "pieces_per_box" | "sqft_per_box" | "finish" | "rate_per_box" | "designs">): Row {
  return { list_label: null, rate_per_sqft: null, hsn_code: null, ...r } as Row;
}

// --- PRICE LIST 01.08.2026.pdf (Fun Enterprises, w.e.f. 01.08.2026) -------------------------------------------------
const bimor = (finish: string, rateBox: number, rateSqft: number, designs: string) =>
  row({ brand: "Bi'mor", effective_from: "2026-08-01", size: "1200 x 600", pieces_per_box: 3, sqft_per_box: 23.25, finish, rate_per_box: rateBox, rate_per_sqft: rateSqft, designs });
const colortile = (size: string, pcs: number, sqft: number, finish: string, rateBox: number, rateSqft: number, designs: string) =>
  row({ brand: "colortile", effective_from: "2026-08-01", size, pieces_per_box: pcs, sqft_per_box: sqft, finish, rate_per_box: rateBox, rate_per_sqft: rateSqft, designs });

const funRows = (): Row[] => [
  bimor("Glossy", 1209, 52, "Calico Crema Endless; Clovia Gris Endless; Dorado Endless; Novella Gris Endless; Novex Crema Endless; Rizzoni Endless"),
  bimor("Matt", 1209, 52, "Alpine Bianco; Alpine Choco; Alpine Gris; Alpine Nero; Alpine Rosata; Alpine Toffee"),
  bimor("Carving", 1371.75, 59, "Calico Crema Endless; Rio Bianco; Rio Camel; Rio Crema; Rio Gris"),
  colortile("600 x 600", 4, 15.5, "Rustic Matt", 883.5, 57, "Imperia Silver; Imperia Pearl; Imperia Choco; Imperia Crema; Imperia Nero; Star white; Arid Desert Palm; Arid Ivory"),
  colortile("600 x 600", 4, 15.5, "Stone", 930, 60, "Parker Bianco; Parker Crema; Parker Gris; Parker Nero; Parker Taupe"),
  colortile("600 x 600", 4, 15.5, "Texture Matt", 961, 62, "Urban Brick Tone; Urban Coal; Urban Cobalt; Urban Copper"),
  colortile("600 x 600", 4, 15.5, "Carving", 1054, 68, "Mandala Bianco; Mandala Pink Crush; Mandala Desert Palm; Royal Charm"),
  colortile("1200 x 195", 6, 15, "Wooden Carving", 1155, 77, "Vintage Crema; Vintage Peanut; Vintage Camel; Vintage Dove; Vintage Wooden"),
  colortile("1200 x 195", 6, 15, "Wooden Carving Decor", 1200, 80, "Historic Camel Decor; Historic Verde Decor; Vibes Ochre Decor; Vibes Camel Decor"),
];

// A later version of the same list: Rustic Matt goes up (883.50 -> 899.00), Star white is dropped, Parker Sand is added.
const funRevisedRows = (): Row[] =>
  funRows().map((r) => {
    const next = { ...r, effective_from: "2026-09-01", list_label: "Sep 2026" };
    if (r.finish === "Rustic Matt") {
      next.rate_per_box = 899;
      next.rate_per_sqft = 58;
      next.designs = String(r.designs).replace("; Star white", "");
    }
    if (r.finish === "Stone") next.designs = `${r.designs}; Parker Sand`;
    return next;
  });

// --- SHCO PL-R 6.1-SEP26.pdf (Icon, R6.1, w.e.f. 07/09/2026) -------------------------------------------------------
const icon = (size: string, pcs: number, sqft: number, finish: string, rateBox: number, rateSqft: number | null, designs: string) =>
  row({ brand: "Icon", list_label: "R6.1", effective_from: new Date(Date.UTC(2026, 8, 7)), size, pieces_per_box: pcs, sqft_per_box: sqft, finish, rate_per_box: rateBox, rate_per_sqft: rateSqft, designs });

const iconRows = (): Row[] => [
  // One group with TWO price rows (899/58 and 930/60).
  icon("600 x 600", 4, 15.5, "Matt & Rustic", 899, 58, "Elementi Bianco; Elementi Copper; Elementi Rosso; Elementi Silver; Foster Beige; Foster Bianco; Opera Beige; Pietra Anthracite"),
  icon("600 x 600", 4, 15.5, "Matt & Rustic", 930, 60, "Trust Brown; Trust Dark Grey; Trust Grey; Trust Grigio; Trust Silver; Trust Taupe; Trust Vanilla"),
  icon("600 x 600", 4, 15.5, "Surface Zero Collection", 1085, 70, "Beton Gris; Beton Silver; Beton Taupe; Key Note Beige; Meta Stone Grigio"),
  // Rate per sq.ft left blank on purpose: it is computed (1007.5 / 15.5 = 65).
  icon("600 x 600", 4, 15.5, "Vintigo", 1007.5, null, "Angeles; Athens; Baku; Beijing; Black & White; Clay Azul; Clay Azul Decor"),
  // The printed list repeats CANIS and PROPUS inside one group: collapsed with a warning.
  icon("600 x 600", 4, 15.5, "Kalakriti", 1379.5, 89, "Agate; Alhena; Altair; Canis; Canis; Canopus; Propus; Propus; Vega"),
  icon("1200 x 600", 3, 23.25, "Express Carving", 1488, 64, "Calcatta Florence; Carling Pearl; Denver Grey; Magnus Bianco; Swift Crema"),
  // Deliberately wrong: 1379.50 / 15.50 = 89, but the sq.ft rate says 98 (digits swapped).
  icon("600 x 600", 4, 15.5, "Persian", 1379.5, 98, "Persian Heriz; Persian Kilim; Persian Motif"),
];

async function write(file: string, rows: Row[], { sheet = "Prices" } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow([...COLUMNS]);
  for (const r of rows) ws.addRow(COLUMNS.map((c) => r[c]));
  const dir = __dirname;
  await wb.xlsx.writeFile(path.join(dir, `${file}.xlsx`));
  // CSV: ISO dates, plain numbers, quotes only where needed.
  const csv = [COLUMNS.join(",")]
    .concat(
      rows.map((r) =>
        COLUMNS.map((c) => {
          const v = r[c];
          const text = v === null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        }).join(","),
      ),
    )
    .join("\n");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(dir, `${file}.csv`), `${csv}\n`);
}

async function main() {
  await write("fun-enterprises-2026-08-01", funRows());
  await write("fun-enterprises-2026-09-revised", funRevisedRows());
  await write("icon-shco-r6-1", iconRows());
  console.log("fixtures written");
}
void main();
