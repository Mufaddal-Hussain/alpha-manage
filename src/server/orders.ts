"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { runAction, ValidationError, type ActionResult } from "@/lib/errors";
import { formValues } from "@/lib/form";
import { deleteStoredFile, saveDocumentUpload } from "@/lib/storage/files";
import { DuplicatePurchaseOrderError, recordPurchaseOrder } from "./order-core";

// Purchase order server actions (T067): session first, then the uploads, then the domain operation in
// src/server/order-core.ts (which holds the rules and the transaction), then revalidate the pages that show the PO.

const MAX_PO_FILES = 5;
/** Server Actions accept 20 MB per request (next.config.ts); leave room for the rest of the form. */
const MAX_PO_UPLOAD_BYTES = 18 * 1024 * 1024;

const QTY_PREFIX = "qty:";
const QTY_FORMAT = /^\d+(\.\d{1,3})?$/;

/**
 * Records the PO from the "Record PO" form. Each ordered quantity arrives as `qty:<quotation line id>`; a blank or zero
 * quantity means the line was not ordered. Attachments are stored first and removed again if the PO is not recorded, so a
 * refused submission leaves no orphan files behind.
 */
export async function recordPurchaseOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const user = await requireUser();
    const values = formValues(formData);
    const quotationId = z.uuid("That quotation could not be found").parse(values.quotationId);

    const lines: { quotationLineId: string; quantity: string }[] = [];
    const lineErrors: Record<string, string> = {};
    for (const [key, raw] of Object.entries(values)) {
      if (!key.startsWith(QTY_PREFIX)) continue;
      const quantity = raw.trim();
      if (quantity === "" || (QTY_FORMAT.test(quantity) && Number(quantity) === 0)) continue;
      if (!QTY_FORMAT.test(quantity)) lineErrors[key] = "Enter a number";
      else lines.push({ quotationLineId: key.slice(QTY_PREFIX.length), quantity });
    }
    if (Object.keys(lineErrors).length) throw new ValidationError("Check the ordered quantities", lineErrors);

    const uploads = formData.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
    if (uploads.length > MAX_PO_FILES) throw new ValidationError(`Attach at most ${MAX_PO_FILES} files`, { files: "Too many files" });
    if (uploads.reduce((sum, f) => sum + f.size, 0) > MAX_PO_UPLOAD_BYTES) {
      throw new ValidationError("The attachments are too large together (limit 18 MB)", { files: "Too large" });
    }

    const stored: string[] = [];
    try {
      for (const upload of uploads) {
        try {
          stored.push((await saveDocumentUpload(upload, user.id, "purchaseOrder")).record.id);
        } catch (error) {
          if (error instanceof ValidationError) throw new ValidationError(`${upload.name}: ${error.message}`, { files: error.message });
          throw error;
        }
      }
      const { id } = await recordPurchaseOrder(getDb(), user.id, {
        quotationId,
        customerPoNumber: values.customerPoNumber ?? "",
        poDate: values.poDate ?? "",
        advanceReceived: values.advanceReceived?.trim() || "0",
        notes: values.notes ?? null,
        lines,
        fileIds: stored,
        confirmDuplicate: values.confirmDuplicate === "on",
      });
      revalidatePath("/orders");
      revalidatePath(`/quotations/${quotationId}`);
      return id;
    } catch (error) {
      for (const fileId of stored) await deleteStoredFile(fileId);
      if (error instanceof DuplicatePurchaseOrderError) {
        // The form shows a "record it anyway" tick when it sees this field.
        throw new ValidationError(error.message, { customerPoNumber: "Already recorded for this customer", confirmDuplicate: error.existingId });
      }
      throw error;
    }
  });
  if (result.ok && typeof result.data === "string") redirect(`/orders/${result.data}`);
  return result as ActionResult;
}
