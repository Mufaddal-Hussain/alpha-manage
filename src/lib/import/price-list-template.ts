import ExcelJS from "exceljs";
import { canonicalColumn, checkHeaders, TEMPLATE_COLUMNS, validatePriceRows, type RawRow, type RowResult, type TemplateColumn } from "./price-list-rules";

export { TEMPLATE_COLUMNS };

// Reads and writes the Excel/CSV price-list template (contracts/price-list-import.md). No PDF or AI extraction:
// staff type or paste the rows of a distributor's list into this template (one row covers a whole group of designs).

export const TEMPLATE_SHEET = "Prices";
const MAX_ROWS = 5000;

export interface RawSheet {
  fileErrors: string[];
  rows: RawRow[];
}

export interface ParsedFile {
  fileErrors: string[];
  rows: RowResult[];
}

/** One filled-in example row, taken from the Fun Enterprises list in samples/. */
const EXAMPLE_ROW: Record<TemplateColumn, string | number> = {
  brand: "colortile",
  list_label: "",
  effective_from: "2026-08-01",
  size: "600 x 600",
  pieces_per_box: 4,
  sqft_per_box: 15.5,
  finish: "Rustic Matt",
  rate_per_box: 883.5,
  rate_per_sqft: 57,
  designs: "Imperia Silver; Imperia Pearl; Star white",
  hsn_code: "",
};

const HELP: [string, string][] = [
  ["brand", "Required. Brand name as it should appear in the catalog. A brand that does not exist yet is created when you approve the import."],
  ["list_label", "Optional. Revision label shown in version history, for example R6.1."],
  ["effective_from", "Required. The w.e.f. date, written YYYY-MM-DD (2026-08-01). One date per brand in a file."],
  ["size", "Required. Free text such as 600 x 600; length and width are read from NxM."],
  ["pieces_per_box", "Required. Tiles in one box."],
  ["sqft_per_box", "Required. Coverage of one box in square feet, for example 15.50."],
  ["finish", "Required. The group or category name as printed, for example Glossy or Rustic Matt."],
  ["rate_per_box", "Required. Distributor rate for one box in rupees, excluding GST."],
  ["rate_per_sqft", "Optional. Rate per sq.ft as printed. If blank it is worked out; if given it must be within ₹1 of rate per box ÷ sq.ft per box."],
  ["designs", "Required. Every design that shares this price, separated by semicolons (;)."],
  ["hsn_code", "Optional. If blank, the default HSN code from the business profile is used."],
];

/** The downloadable `.xlsx` template: the `Prices` sheet with its header and one example row, plus a help sheet. */
export async function buildTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(TEMPLATE_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow([...TEMPLATE_COLUMNS]);
  sheet.addRow(TEMPLATE_COLUMNS.map((c) => EXAMPLE_ROW[c]));
  sheet.getRow(1).font = { bold: true };
  const widths: Record<TemplateColumn, number> = {
    brand: 14, list_label: 12, effective_from: 15, size: 12, pieces_per_box: 15, sqft_per_box: 13, finish: 20, rate_per_box: 13, rate_per_sqft: 13, designs: 60, hsn_code: 10,
  };
  sheet.columns = TEMPLATE_COLUMNS.map((c) => ({ width: widths[c] }));
  // Keep codes and dates as typed: text format stops Excel turning 2026-08-01 into a locale date.
  sheet.getColumn(3).numFmt = "@";
  sheet.getColumn(11).numFmt = "@";

  const help = wb.addWorksheet("How to fill");
  help.addRow(["Column", "What to enter"]).font = { bold: true };
  for (const line of HELP) help.addRow(line);
  help.addRow([]);
  help.addRow(["", "One row per price of a group. A group with two prices is two rows. Delete the example row before importing."]);
  help.columns = [{ width: 18 }, { width: 120 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Text of an Excel cell value as people see it; dates become ISO (UTC midnight, which is how Excel dates read). */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  if ("text" in value) return String(value.text);
  return "";
}

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF, optional BOM. Everything stays text. */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function toRawRows(grid: string[][]): RawSheet {
  if (grid.length === 0 || grid[0].every((h) => h.trim() === "")) {
    return { fileErrors: ["The file is empty. It needs a header row and at least one price row."], rows: [] };
  }
  const headerProblems = checkHeaders(grid[0]);
  if (headerProblems.length > 0) return { fileErrors: headerProblems, rows: [] };

  const known = new Set<string>(TEMPLATE_COLUMNS);
  const columns = grid[0].map((h) => canonicalColumn(h)).map((c) => (known.has(c) ? (c as TemplateColumn) : null));
  const rows: RawRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells: Partial<Record<TemplateColumn, string>> = {};
    let any = false;
    columns.forEach((column, i) => {
      if (!column) return;
      const text = (grid[r][i] ?? "").trim();
      if (text !== "") any = true;
      cells[column] = text;
    });
    if (any) rows.push({ rowNumber: r + 1, cells });
  }
  if (rows.length === 0) return { fileErrors: ["The file has a header row but no price rows."], rows: [] };
  if (rows.length > MAX_ROWS) return { fileErrors: [`The file has ${rows.length} price rows; the limit is ${MAX_ROWS}. Split it into two files.`], rows: [] };
  return { fileErrors: [], rows };
}

/** Reads the cells of an `.xlsx` or `.csv` file into raw text rows without validating them. */
export async function readRawRows(bytes: Buffer, fileName: string): Promise<RawSheet> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    return toRawRows(parseCsv(bytes.toString("utf8")));
  }
  if (!lower.endsWith(".xlsx")) {
    return { fileErrors: ["Only .xlsx and .csv files can be imported. A PDF can be attached to the price list as a reference, but it is not read."], rows: [] };
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return { fileErrors: ["That file could not be opened as an Excel workbook (.xlsx)."], rows: [] };
  }
  const sheet = wb.getWorksheet(TEMPLATE_SHEET) ?? wb.worksheets[0];
  if (!sheet) return { fileErrors: ["The workbook has no sheets."], rows: [] };
  const width = Math.max(sheet.columnCount, TEMPLATE_COLUMNS.length);
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    // Keep row numbers aligned with the sheet even if earlier rows are empty.
    while (grid.length < rowNumber - 1) grid.push([]);
    grid[rowNumber - 1] = cells;
  });
  return toRawRows(grid);
}

/** Reads and validates a template file. Every data row yields a result; file-level problems come back in `fileErrors`. */
export async function parsePriceListFile(bytes: Buffer, fileName: string): Promise<ParsedFile> {
  const sheet = await readRawRows(bytes, fileName);
  if (sheet.fileErrors.length > 0) return { fileErrors: sheet.fileErrors, rows: [] };
  return { fileErrors: [], rows: validatePriceRows(sheet.rows) };
}
