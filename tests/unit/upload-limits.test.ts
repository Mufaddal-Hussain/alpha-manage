import { describe, expect, it } from "vitest";
import { DOCUMENT_KINDS, saveDocumentUpload, saveImageUpload } from "@/lib/storage/files";

// T081 / spec edge case "attachments are large or in an unexpected format": uploads are refused with a clear message
// before anything is stored (these paths throw before the storage or database is touched, so no setup is needed).

const MB = 1024 * 1024;
const file = (bytes: Uint8Array | string, name: string, type = "application/octet-stream") => new File([typeof bytes === "string" ? Buffer.from(bytes) : (bytes as BlobPart)], name, { type });
const pdfBytes = "%PDF-1.4\n%%EOF\n";

describe("document uploads are limited in size and type", () => {
  it("states the limits", () => {
    expect(DOCUMENT_KINDS.purchaseOrder.maxBytes).toBe(10 * MB);
    expect(DOCUMENT_KINDS.template.maxBytes).toBe(5 * MB);
    expect(DOCUMENT_KINDS.reference.maxBytes).toBe(15 * MB);
  });

  it("refuses an empty file", async () => {
    await expect(saveDocumentUpload(file("", "po.pdf", "application/pdf"), "u", "purchaseOrder")).rejects.toThrow("The selected file is empty");
  });

  it.each([
    ["purchaseOrder", "PO file", 10],
    ["template", "template", 5],
    ["reference", "PDF", 15],
  ] as const)("refuses a %s over its size limit", async (kind, label, limit) => {
    const big = new Uint8Array(limit * MB + 1);
    await expect(saveDocumentUpload(file(big, "x.pdf", "application/pdf"), "u", kind)).rejects.toThrow(`The ${label} is too large (limit ${limit} MB)`);
  });

  it("refuses a PO that is not a PDF or a picture, whatever the browser says it is", async () => {
    await expect(saveDocumentUpload(file("MZ-not-a-pdf", "po.pdf", "application/pdf"), "u", "purchaseOrder")).rejects.toThrow("Attach the PO as a PDF, or a PNG, JPEG or WebP picture");
    await expect(saveDocumentUpload(file(pdfBytes, "po.exe", "application/pdf"), "u", "purchaseOrder")).rejects.toThrow("Attach the PO as a PDF");
    await expect(saveDocumentUpload(file("<script>alert(1)</script>", "po.png", "image/png"), "u", "purchaseOrder")).rejects.toThrow("Attach the PO as a PDF");
  });

  it("accepts only a real PDF as a reference file and only .xlsx/.csv as a template", async () => {
    await expect(saveDocumentUpload(file("PK\u0003\u0004zip", "list.pdf"), "u", "reference")).rejects.toThrow("The reference file must be a PDF");
    await expect(saveDocumentUpload(file(pdfBytes, "list.pdf"), "u", "template")).rejects.toThrow("Choose the price-list template as an .xlsx or .csv file");
    await expect(saveDocumentUpload(file("a\u0000b", "list.csv"), "u", "template")).rejects.toThrow("Choose the price-list template");
  });

  it("refuses an image that is too large or not a real PNG, JPEG or WebP", async () => {
    await expect(saveImageUpload(file(new Uint8Array(2 * MB + 1), "logo.png", "image/png"), "u")).rejects.toThrow("The image is too large (limit 2 MB)");
    await expect(saveImageUpload(file("GIF89a....", "logo.png", "image/png"), "u")).rejects.toThrow("Only PNG, JPEG or WebP images are accepted");
  });
});
