"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { runAction, ValidationError, type ActionResult } from "@/lib/errors";
import { formValues } from "@/lib/form";
import { cancelChallan, createChallan } from "./challan-core";

// Delivery challan server actions (T073): session first, then the domain operation in src/server/challan-core.ts (which
// holds the rules, the role checks and the transaction), then revalidate the pages that show the challan or the PO.

const QTY_PREFIX = "qty:";
const QTY_FORMAT = /^\d+(\.\d{1,3})?$/;

function revalidateChallan(orderId: string, challanId?: string) {
  revalidatePath("/challans");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  if (challanId) revalidatePath(`/challans/${challanId}`);
}

/** The domain reports `consignee.gstin`; the form's inputs are named `consigneeGstin`. */
function formFieldErrors(errors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).map(([key, message]) => [key.replace(/^consignee\.(\w)/, (_, c: string) => `consignee${c.toUpperCase()}`), message]));
}

/**
 * Issues the challan from the "New challan" form. Each quantity arrives as `qty:<PO line id>`; a blank or zero quantity
 * means that item is not on this dispatch. The form is prefilled with the ship-to of the quotation, so the consignee
 * fields it sends are the consignee of this dispatch, whether or not the person changed them.
 */
export async function createChallanAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const user = await requireUser();
    const values = formValues(formData);
    const purchaseOrderId = z.uuid("That PO could not be found").parse(values.purchaseOrderId);

    const lines: { poLineId: string; quantity: string }[] = [];
    const lineErrors: Record<string, string> = {};
    for (const [key, raw] of Object.entries(values)) {
      if (!key.startsWith(QTY_PREFIX)) continue;
      const quantity = raw.trim();
      if (quantity === "" || (QTY_FORMAT.test(quantity) && Number(quantity) === 0)) continue;
      if (!QTY_FORMAT.test(quantity)) lineErrors[key] = "Enter a number";
      else lines.push({ poLineId: key.slice(QTY_PREFIX.length), quantity });
    }
    if (Object.keys(lineErrors).length) throw new ValidationError("Check the delivered quantities", lineErrors);

    const created = await createChallan(getDb(), user.id, {
      purchaseOrderId,
      challanDate: values.challanDate ?? "",
      consignee: {
        name: values.consigneeName ?? "",
        address: values.consigneeAddress ?? null,
        gstin: values.consigneeGstin ?? null,
        stateCode: values.consigneeStateCode ?? "",
      },
      modeTermsOfPayment: values.modeTermsOfPayment ?? null,
      referenceNoDate: values.referenceNoDate ?? null,
      otherReferences: values.otherReferences ?? null,
      dispatchDocNo: values.dispatchDocNo ?? null,
      dispatchedThrough: values.dispatchedThrough ?? null,
      destination: values.destination ?? null,
      termsOfDelivery: values.termsOfDelivery ?? null,
      vehicleNo: values.vehicleNo ?? null,
      driverName: values.driverName ?? null,
      driverPhone: values.driverPhone ?? null,
      showPrices: values.showPrices === "on",
      // Only an owner can use it; the core refuses it from anyone else when it would be needed.
      overrideReason: values.overrideReason ?? null,
      lines,
    }).catch((error: unknown) => {
      throw error instanceof ValidationError ? new ValidationError(error.message, formFieldErrors(error.fieldErrors)) : error;
    });
    revalidateChallan(purchaseOrderId);
    return created.id;
  });
  if (result.ok && typeof result.data === "string") redirect(`/challans/${result.data}`);
  return result as ActionResult;
}

export async function cancelChallanAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const values = formValues(formData);
    const { id, purchaseOrderId } = await cancelChallan(getDb(), user.id, { id: values.id ?? "", reason: values.reason ?? "" });
    revalidateChallan(purchaseOrderId, id);
  }, "Challan cancelled");
}
