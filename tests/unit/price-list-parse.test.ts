import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildTemplateWorkbook, parsePriceListFile, TEMPLATE_COLUMNS } from "@/lib/import/price-list-template";
import { checkHeaders, parseSize, splitDesigns, validatePriceRows, type RawRow } from "@/lib/import/price-list-rules";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/price-lists", name));

/** One raw template row with sensible defaults; tests override what they exercise. */
function raw(rowNumber: number, overrides: Record<string, string> = {}): RawRow {
  return {
    rowNumber,
    cells: {
      brand: "colortile",
      list_label: "",
      effective_from: "2026-08-01",
      size: "600 x 600",
      pieces_per_box: "4",
      sqft_per_box: "15.50",
      finish: "Rustic Matt",
      rate_per_box: "883.50",
      rate_per_sqft: "57.00",
      designs: "Imperia Silver; Imperia Pearl",
      hsn_code: "",
      ...overrides,
    },
  };
}

describe("template headers", () => {
  it("accepts the full header row, in any case and with spaces for underscores", () => {
    expect(checkHeaders([...TEMPLATE_COLUMNS])).toEqual([]);
    expect(checkHeaders(["Brand", "Effective From", "Size", "Pieces per box", "SQFT_PER_BOX", "Finish", "Rate Per Box", "Designs"])).toEqual([]);
  });

  it("does not need the optional columns", () => {
    const required = ["brand", "effective_from", "size", "pieces_per_box", "sqft_per_box", "finish", "rate_per_box", "designs"];
    expect(checkHeaders(required)).toEqual([]);
  });

  it("names every missing required column", () => {
    const problems = checkHeaders(["brand", "size", "designs"]);
    expect(problems).toHaveLength(1);
    for (const column of ["effective_from", "pieces_per_box", "sqft_per_box", "finish", "rate_per_box"]) expect(problems[0]).toContain(column);
    expect(problems[0]).not.toContain("hsn_code");
  });
});

describe("designs and sizes", () => {
  it("splits designs on semicolons, trims them and drops empty parts", () => {
    expect(splitDesigns(" Imperia Silver ;Imperia Pearl;; Star white; ").designs).toEqual(["Imperia Silver", "Imperia Pearl", "Star white"]);
  });

  it("collapses a design repeated inside one cell and says so", () => {
    const { designs, collapsed } = splitDesigns("Canis; Propus; canis; PROPUS; Vega");
    expect(designs).toEqual(["Canis", "Propus", "Vega"]);
    expect(collapsed).toEqual(["Canis", "Propus"]);
  });

  it("reads length and width from NxM and normalises the label", () => {
    expect(parseSize("600 x 600")).toEqual({ label: "600 x 600", lengthMm: 600, widthMm: 600 });
    expect(parseSize("1200X195")).toEqual({ label: "1200 x 195", lengthMm: 1200, widthMm: 195 });
    expect(parseSize("600mm × 1200 mm")).toEqual({ label: "600 x 1200", lengthMm: 600, widthMm: 1200 });
    expect(parseSize("Slab")).toEqual({ label: "Slab", lengthMm: null, widthMm: null });
  });
});

describe("row rules", () => {
  it("accepts a good row and keeps the published rates as given", () => {
    const [result] = validatePriceRows([raw(2)]);
    expect(result.errors).toEqual([]);
    expect(result.row).toMatchObject({
      brand: "colortile",
      effectiveFrom: "2026-08-01",
      size: "600 x 600",
      lengthMm: 600,
      widthMm: 600,
      piecesPerBox: 4,
      sqftPerBox: "15.50",
      finish: "Rustic Matt",
      ratePerBox: "883.50",
      ratePerSqft: "57.00",
      designs: ["Imperia Silver", "Imperia Pearl"],
      hsnCode: null,
    });
  });

  it("computes rate per sq.ft when it is blank", () => {
    const [result] = validatePriceRows([raw(2, { rate_per_sqft: "", rate_per_box: "1007.50" })]);
    expect(result.errors).toEqual([]);
    expect(result.row?.ratePerSqft).toBe("65.00");
  });

  it("accepts a stated sq.ft rate exactly ₹1 away from rate per box ÷ sq.ft per box, and rejects more", () => {
    // 899 / 15.5 = 58.0
    expect(validatePriceRows([raw(2, { rate_per_box: "899", rate_per_sqft: "59" })])[0].errors).toEqual([]);
    expect(validatePriceRows([raw(2, { rate_per_box: "899", rate_per_sqft: "57" })])[0].errors).toEqual([]);
    const [bad] = validatePriceRows([raw(2, { rate_per_box: "899", rate_per_sqft: "59.01" })]);
    expect(bad.row).toBeNull();
    expect(bad.errors.join(" ")).toMatch(/rate per sq\.ft/i);
    expect(bad.errors.join(" ")).toContain("58.00");
  });

  it("reports every missing required value on the row", () => {
    const [result] = validatePriceRows([raw(7, { brand: "", size: "", finish: "", designs: "", rate_per_box: "" })]);
    expect(result.row).toBeNull();
    expect(result.rowNumber).toBe(7);
    const text = result.errors.join(" | ");
    for (const field of ["brand", "size", "finish", "designs", "rate_per_box"]) expect(text).toContain(field);
  });

  it("rejects a row with missing or zero packing", () => {
    const cases: Record<string, string>[] = [{ pieces_per_box: "" }, { sqft_per_box: "" }, { pieces_per_box: "0" }, { sqft_per_box: "0" }, { pieces_per_box: "2.5" }];
    for (const overrides of cases) {
      const [result] = validatePriceRows([raw(2, overrides)]);
      expect(result.row, JSON.stringify(overrides)).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects numbers that do not parse and negative rates", () => {
    expect(validatePriceRows([raw(2, { rate_per_box: "eight hundred" })])[0].row).toBeNull();
    expect(validatePriceRows([raw(2, { rate_per_box: "-5", rate_per_sqft: "" })])[0].row).toBeNull();
    expect(validatePriceRows([raw(2, { sqft_per_box: "15,5" })])[0].row).toBeNull();
  });

  it("rejects a date that is not ISO", () => {
    const [result] = validatePriceRows([raw(2, { effective_from: "01/08/2026" })]);
    expect(result.row).toBeNull();
    expect(result.errors.join(" ")).toMatch(/effective_from/);
  });

  it("warns, but does not fail, when a design is repeated inside one cell", () => {
    const [result] = validatePriceRows([raw(2, { designs: "Canis; Canis; Vega" })]);
    expect(result.errors).toEqual([]);
    expect(result.row?.designs).toEqual(["Canis", "Vega"]);
    expect(result.warnings.join(" ")).toContain("Canis");
  });

  it("warns when the size is not NxM (no length and width)", () => {
    const [result] = validatePriceRows([raw(2, { size: "Slab" })]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/size/i);
  });
});

describe("list rules", () => {
  it("rejects a design that appears twice for the same brand, size and finish, on the later row", () => {
    const results = validatePriceRows([
      raw(2, { finish: "Rustic Matt", designs: "Imperia Silver; Star white" }),
      raw(3, { finish: "Rustic Matt", rate_per_box: "930", rate_per_sqft: "60", designs: "Parker Bianco; star WHITE" }),
    ]);
    expect(results[0].errors).toEqual([]);
    expect(results[1].row).toBeNull();
    expect(results[1].errors.join(" ")).toMatch(/star white/i);
    expect(results[1].errors.join(" ")).toMatch(/row 2/);
  });

  it("allows the same design under another finish, as the printed Bi'mor list does (Calico Crema Endless: Glossy and Carving)", () => {
    const results = validatePriceRows([
      raw(2, { brand: "Bi'mor", finish: "Glossy", designs: "Calico Crema Endless; Dorado Endless" }),
      raw(3, { brand: "Bi'mor", finish: "Carving", rate_per_box: "1371.75", sqft_per_box: "23.25", pieces_per_box: "3", rate_per_sqft: "59", designs: "Calico Crema Endless; Rio Bianco" }),
    ]);
    expect(results.map((r) => r.errors)).toEqual([[], []]);
  });

  it("allows the same design in another size or under another brand", () => {
    const results = validatePriceRows([
      raw(2, { designs: "Vintage Crema" }),
      raw(3, { size: "1200 x 195", pieces_per_box: "6", sqft_per_box: "15", rate_per_box: "1155", rate_per_sqft: "77", designs: "Vintage Crema" }),
      raw(4, { brand: "Bi'mor", designs: "Vintage Crema" }),
    ]);
    expect(results.map((r) => r.errors)).toEqual([[], [], []]);
  });

  it("allows one group (size + finish) to have two price rows", () => {
    const results = validatePriceRows([
      raw(2, { finish: "Matt & Rustic", rate_per_box: "899", rate_per_sqft: "58", designs: "Elementi Bianco; Elementi Copper" }),
      raw(3, { finish: "Matt & Rustic", rate_per_box: "930", rate_per_sqft: "60", designs: "Trust Brown; Trust Grey" }),
    ]);
    expect(results.map((r) => r.errors)).toEqual([[], []]);
    expect(results.map((r) => r.row?.ratePerBox)).toEqual(["899.00", "930.00"]);
  });

  it("flags a row whose effective date or list label differs from the other rows of its brand", () => {
    const results = validatePriceRows([
      raw(2, { list_label: "R6.1", designs: "A" }),
      raw(3, { list_label: "R6.1", effective_from: "2026-09-07", designs: "B" }),
      raw(4, { list_label: "R6.2", designs: "C" }),
    ]);
    expect(results[0].errors).toEqual([]);
    expect(results[1].errors.join(" ")).toMatch(/effective_from/);
    expect(results[2].errors.join(" ")).toMatch(/list_label/);
  });

  it("keeps row numbers so every unreadable row can be reported", () => {
    const results = validatePriceRows([raw(2), raw(5, { size: "" }), raw(9, { rate_per_box: "x" })]);
    expect(results.map((r) => r.rowNumber)).toEqual([2, 5, 9]);
    expect(results.filter((r) => r.row === null)).toHaveLength(2);
  });
});

describe("template builder", () => {
  it("produces a workbook with a Prices sheet and the contract's header row", async () => {
    const bytes = await buildTemplateWorkbook();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Prices");
    expect(sheet).toBeDefined();
    expect((sheet!.getRow(1).values as unknown[]).slice(1)).toEqual([...TEMPLATE_COLUMNS]);
  });

  it("a template with only its example row filled in parses cleanly", async () => {
    const bytes = await buildTemplateWorkbook();
    const parsed = await parsePriceListFile(bytes, "template.xlsx");
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows.every((r) => r.errors.length === 0)).toBe(true);
  });
});

describe("fixture: PRICE LIST 01.08.2026 (Bi'mor and colortile)", () => {
  it("reads every row of the Excel file with no errors", async () => {
    const { fileErrors, rows } = await parsePriceListFile(fixture("fun-enterprises-2026-08-01.xlsx"), "fun.xlsx");
    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(9);
    expect(rows.flatMap((r) => r.errors)).toEqual([]);
    expect([...new Set(rows.map((r) => r.row!.brand))].sort()).toEqual(["Bi'mor", "colortile"]);
  });

  it("includes the two groups named in the import contract", async () => {
    const { rows } = await parsePriceListFile(fixture("fun-enterprises-2026-08-01.xlsx"), "fun.xlsx");
    const groups = rows.map((r) => r.row!);
    expect(groups).toContainEqual(
      expect.objectContaining({ brand: "Bi'mor", size: "1200 x 600", piecesPerBox: 3, sqftPerBox: "23.25", finish: "Glossy", ratePerBox: "1209.00", ratePerSqft: "52.00", effectiveFrom: "2026-08-01" }),
    );
    expect(groups).toContainEqual(
      expect.objectContaining({ brand: "colortile", size: "600 x 600", piecesPerBox: 4, sqftPerBox: "15.50", finish: "Rustic Matt", ratePerBox: "883.50", ratePerSqft: "57.00" }),
    );
  });

  it("reads the CSV copy to exactly the same rows as the Excel file", async () => {
    const fromXlsx = await parsePriceListFile(fixture("fun-enterprises-2026-08-01.xlsx"), "fun.xlsx");
    const fromCsv = await parsePriceListFile(fixture("fun-enterprises-2026-08-01.csv"), "fun.csv");
    expect(fromCsv.fileErrors).toEqual([]);
    expect(fromCsv.rows.map((r) => r.row)).toEqual(fromXlsx.rows.map((r) => r.row));
  });
});

describe("fixture: SHCO PL-R 6.1 (Icon)", () => {
  it("reads the Icon list with its label and a date-typed effective_from", async () => {
    const { fileErrors, rows } = await parsePriceListFile(fixture("icon-shco-r6-1.xlsx"), "icon.xlsx");
    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(7);
    for (const r of rows.filter((x) => x.row)) {
      expect(r.row).toMatchObject({ brand: "Icon", listLabel: "R6.1", effectiveFrom: "2026-09-07" });
    }
  });

  it("keeps Matt & Rustic as one group with two price rows (899/58 and 930/60)", async () => {
    const { rows } = await parsePriceListFile(fixture("icon-shco-r6-1.xlsx"), "icon.xlsx");
    const mattRustic = rows.map((r) => r.row).filter((r) => r?.finish === "Matt & Rustic");
    expect(mattRustic.map((r) => [r!.ratePerBox, r!.ratePerSqft])).toEqual([
      ["899.00", "58.00"],
      ["930.00", "60.00"],
    ]);
    expect(mattRustic.every((r) => r!.size === "600 x 600" && r!.piecesPerBox === 4 && r!.sqftPerBox === "15.50")).toBe(true);
  });

  it("reports the deliberately wrong rate row as an error and still reads the rest", async () => {
    const { rows } = await parsePriceListFile(fixture("icon-shco-r6-1.xlsx"), "icon.xlsx");
    const bad = rows.filter((r) => r.row === null);
    expect(bad).toHaveLength(1);
    expect(bad[0].errors.join(" ")).toMatch(/rate per sq\.ft/i);
    expect(bad[0].rowNumber).toBe(8);
    expect(rows.filter((r) => r.row !== null)).toHaveLength(6);
  });

  it("computes the blank sq.ft rate (Vintigo) and collapses the repeated designs (Kalakriti)", async () => {
    const { rows } = await parsePriceListFile(fixture("icon-shco-r6-1.xlsx"), "icon.xlsx");
    const vintigo = rows.find((r) => r.row?.finish === "Vintigo")!;
    expect(vintigo.row!.ratePerSqft).toBe("65.00");
    const kalakriti = rows.find((r) => r.row?.finish === "Kalakriti")!;
    expect(kalakriti.row!.designs).toEqual(["Agate", "Alhena", "Altair", "Canis", "Canopus", "Propus", "Vega"]);
    expect(kalakriti.warnings.join(" ")).toMatch(/Canis/);
  });
});

describe("file-level problems", () => {
  it("reports a file with no recognisable header instead of guessing", async () => {
    const csv = Buffer.from("name,price\nTile,100\n");
    const { fileErrors, rows } = await parsePriceListFile(csv, "wrong.csv");
    expect(rows).toEqual([]);
    expect(fileErrors.join(" ")).toContain("brand");
  });

  it("reports an empty file", async () => {
    const { fileErrors } = await parsePriceListFile(Buffer.from(""), "empty.csv");
    expect(fileErrors.length).toBeGreaterThan(0);
  });

  it("refuses a file that is neither .xlsx nor .csv", async () => {
    const { fileErrors } = await parsePriceListFile(Buffer.from("x"), "list.pdf");
    expect(fileErrors.join(" ")).toMatch(/xlsx|csv/i);
  });
});
