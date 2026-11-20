"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { product } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireRole, requireUser } from "@/lib/auth/session";
import { NotFoundError, runAction, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/form";
import { resolveSelling } from "@/lib/catalog/pricing";
import { productSchema, sellingPriceSchema } from "@/lib/product-schema";

// Manual product management (T042). Any signed-in staff member can add products and set selling prices;
// changing HSN, GST rate or the other product facts, and discontinuing, are owner actions (contracts/ui-routes.md).

function productPaths(id?: string) {
  revalidatePath("/catalog/products");
  if (id) revalidatePath(`/catalog/products/${id}`);
}

export async function createProduct(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const user = await requireUser();
    // A hand-entered product has no cost price, so there is no margin to keep (marginPercent is ignored here).
    const { marginPercent, ...values } = parseForm(productSchema, formData);
    void marginPercent;
    const created = await getDb().transaction(async (tx) => {
      const [row] = await tx.insert(product).values(values).returning({ id: product.id });
      await recordAudit(tx, { userId: user.id, entityType: "product", entityId: row.id, action: "create", note: values.name });
      return row;
    });
    productPaths();
    return created.id;
  });
  if (result.ok && typeof result.data === "string") redirect(`/catalog/products/${result.data}`);
  return result as ActionResult;
}

export async function updateProduct(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const id = z.uuid().parse(formData.get("id"));
    await getDb().transaction(async (tx) => {
      const [existing] = await tx.select().from(product).where(eq(product.id, id)).for("update");
      if (!existing) throw new NotFoundError("That product no longer exists");
      // Price and margin stay consistent: whichever the person changed wins and the other follows (FR-009).
      // Saving the price also counts as the review of a cost change made by an import.
      const resolveFrom = (price: string | null, margin: string) =>
        resolveSelling({ cost: existing.costPerUnit, currentPrice: existing.sellingPricePerUnit, currentMargin: existing.marginPercent, price, margin });
      if (user.role === "owner") {
        const { marginPercent, ...values } = parseForm(productSchema, formData);
        const selling = resolveFrom(values.sellingPricePerUnit, marginPercent);
        await tx
          .update(product)
          .set({ ...values, sellingPricePerUnit: selling.price, marginPercent: selling.margin, costReviewNeeded: false })
          .where(eq(product.id, id));
      } else {
        // Sales staff may only change the selling price; everything else keeps its stored value.
        const values = parseForm(sellingPriceSchema, formData);
        const selling = resolveFrom(values.sellingPricePerUnit, values.marginPercent);
        await tx
          .update(product)
          .set({ sellingPricePerUnit: selling.price, marginPercent: selling.margin, costReviewNeeded: false })
          .where(eq(product.id, id));
      }
      await recordAudit(tx, { userId: user.id, entityType: "product", entityId: id, action: "update" });
    });
    productPaths(id);
  }, "Product saved");
}

/** Discontinued products stay on old quotations but cannot be added to new ones. Owner only. */
export async function setProductStatus(formData: FormData): Promise<void> {
  const user = await requireRole("owner");
  const id = z.uuid().parse(formData.get("id"));
  const status = formData.get("status") === "discontinued" ? "discontinued" : "active";
  await getDb().transaction(async (tx) => {
    const updated = await tx.update(product).set({ status }).where(eq(product.id, id)).returning({ id: product.id });
    if (updated.length === 0) return;
    await recordAudit(tx, {
      userId: user.id,
      entityType: "product",
      entityId: id,
      action: "status_change",
      fromStatus: status === "active" ? "discontinued" : "active",
      toStatus: status,
    });
  });
  productPaths(id);
}
