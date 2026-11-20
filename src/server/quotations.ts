"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import * as core from "@/server/quotation-core";

// Quotation server actions (T044): session first, then the domain operation in src/server/quotation-core.ts
// (which holds the rules and the transaction), then revalidate the pages that show the quotation.

function revalidateQuotation(id: string) {
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  revalidatePath(`/quotations/${id}/revise`);
}

const idOf = (formData: FormData) => z.uuid("That quotation could not be found").parse(formData.get("id"));
const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};

/** Creates a draft or saves the one in `input.quotationId`. Called by the editor with its whole state. */
export async function saveQuotationDraft(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    const saved = await core.saveDraft(getDb(), user.id, input as core.DraftInput);
    revalidateQuotation(saved.id);
    return { id: saved.id };
  }, "Draft saved");
}

/** Issues (sends) a saved draft; the editor saves first and then calls this with the id. */
export async function issueQuotationAction(id: string): Promise<ActionResult<{ id: string; number: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    const quotationId = z.uuid().parse(id);
    const { number } = await core.issueQuotation(getDb(), user.id, quotationId);
    revalidateQuotation(quotationId);
    return { id: quotationId, number };
  }, "Quotation issued");
}

export async function sendQuotationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const id = idOf(formData);
    await core.sendQuotation(getDb(), user.id, id);
    revalidateQuotation(id);
  }, "Marked as sent");
}

export async function approveQuotationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const id = idOf(formData);
    await core.approveQuotation(getDb(), user.id, id);
    revalidateQuotation(id);
  }, "Quotation approved");
}

export async function rejectQuotationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const id = idOf(formData);
    await core.rejectQuotation(getDb(), user.id, id, text(formData, "note"));
    revalidateQuotation(id);
  }, "Quotation rejected");
}

export async function reinstateQuotationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const id = idOf(formData);
    await core.reinstateQuotation(getDb(), user.id, id, { note: text(formData, "note"), validUntil: text(formData, "validUntil") || null });
    revalidateQuotation(id);
  }, "Quotation reinstated");
}

/** Starts the next revision, then opens it for editing. */
export async function reviseQuotationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const user = await requireUser();
    const id = idOf(formData);
    await core.reviseQuotation(getDb(), user.id, id);
    revalidateQuotation(id);
    return id;
  });
  if (result.ok && typeof result.data === "string") redirect(`/quotations/${result.data}/revise`);
  return result as ActionResult;
}

export async function duplicateQuotationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const user = await requireUser();
    const copy = await core.duplicateQuotation(getDb(), user.id, idOf(formData));
    revalidatePath("/quotations");
    return copy.id;
  });
  if (result.ok && typeof result.data === "string") redirect(`/quotations/${result.data}/revise`);
  return result as ActionResult;
}

export async function deleteDraftAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const user = await requireUser();
    await core.deleteDraft(getDb(), user.id, idOf(formData));
    revalidatePath("/quotations");
    return true;
  });
  if (result.ok) redirect("/quotations");
  return result as ActionResult;
}
