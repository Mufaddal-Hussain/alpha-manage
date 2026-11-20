"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { customer, customerAddress, customerContact } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { customerAddressSchema, customerContactSchema, customerSchema } from "@/lib/customer-schema";
import { NotFoundError, runAction, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/form";

// Customer master actions (T034). Every action authorises first (any signed-in staff may maintain customers).

function customerPaths(id: string) {
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}

export async function createCustomer(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  // redirect() throws, so it must stay outside runAction's body result handling: runAction re-throws it untouched.
  const result = await runAction(async () => {
    const user = await requireUser();
    const values = parseForm(customerSchema, formData);
    const db = getDb();
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(customer).values(values).returning({ id: customer.id });
      await recordAudit(tx, { userId: user.id, entityType: "customer", entityId: row.id, action: "create", note: values.displayName });
      return row;
    });
    revalidatePath("/customers");
    return created.id;
  });
  if (result.ok && typeof result.data === "string") redirect(`/customers/${result.data}`);
  return result as ActionResult;
}

export async function updateCustomer(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const id = z.uuid().parse(formData.get("id"));
    const values = parseForm(customerSchema, formData);
    await getDb().transaction(async (tx) => {
      const updated = await tx.update(customer).set(values).where(eq(customer.id, id)).returning({ id: customer.id });
      if (updated.length === 0) throw new NotFoundError("That customer no longer exists");
      await recordAudit(tx, { userId: user.id, entityType: "customer", entityId: id, action: "update" });
    });
    customerPaths(id);
  }, "Customer saved");
}

/** Deactivated customers drop out of search and pickers but their documents stay intact. */
export async function setCustomerActive(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.uuid().parse(formData.get("id"));
  const active = formData.get("active") === "true";
  await getDb().transaction(async (tx) => {
    const updated = await tx.update(customer).set({ active }).where(eq(customer.id, id)).returning({ id: customer.id });
    if (updated.length === 0) return;
    await recordAudit(tx, { userId: user.id, entityType: "customer", entityId: id, action: active ? "reactivate" : "deactivate" });
  });
  customerPaths(id);
}

export async function saveCustomerAddress(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const customerId = z.uuid().parse(formData.get("customerId"));
    const { id, isDefaultShipping, ...values } = parseForm(customerAddressSchema, formData);
    const makeDefault = isDefaultShipping === "on";
    await getDb().transaction(async (tx) => {
      const [owner] = await tx.select({ id: customer.id }).from(customer).where(eq(customer.id, customerId)).for("update");
      if (!owner) throw new NotFoundError("That customer no longer exists");
      let addressId = id;
      if (makeDefault) {
        // Clear the old default first: the unique index allows only one per customer.
        await tx
          .update(customerAddress)
          .set({ isDefaultShipping: false })
          .where(and(eq(customerAddress.customerId, customerId), id ? ne(customerAddress.id, id) : undefined));
      }
      if (addressId) {
        const updated = await tx
          .update(customerAddress)
          .set({ ...values, isDefaultShipping: makeDefault })
          .where(and(eq(customerAddress.id, addressId), eq(customerAddress.customerId, customerId)))
          .returning({ id: customerAddress.id });
        if (updated.length === 0) throw new NotFoundError("That address no longer exists");
      } else {
        const [created] = await tx
          .insert(customerAddress)
          .values({ ...values, customerId, isDefaultShipping: makeDefault })
          .returning({ id: customerAddress.id });
        addressId = created.id;
      }
      await recordAudit(tx, {
        userId: user.id,
        entityType: "customer",
        entityId: customerId,
        action: id ? "update_address" : "add_address",
        note: values.label,
      });
    });
    customerPaths(customerId);
  }, "Address saved");
}

export async function deleteCustomerAddress(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.uuid().parse(formData.get("id"));
  const customerId = z.uuid().parse(formData.get("customerId"));
  await getDb().transaction(async (tx) => {
    const deleted = await tx
      .delete(customerAddress)
      .where(and(eq(customerAddress.id, id), eq(customerAddress.customerId, customerId)))
      .returning({ label: customerAddress.label });
    if (deleted.length === 0) return;
    await recordAudit(tx, { userId: user.id, entityType: "customer", entityId: customerId, action: "delete_address", note: deleted[0].label });
  });
  customerPaths(customerId);
}

export async function saveCustomerContact(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const customerId = z.uuid().parse(formData.get("customerId"));
    const { id, ...values } = parseForm(customerContactSchema, formData);
    await getDb().transaction(async (tx) => {
      const [owner] = await tx.select({ id: customer.id }).from(customer).where(eq(customer.id, customerId));
      if (!owner) throw new NotFoundError("That customer no longer exists");
      if (id) {
        const updated = await tx
          .update(customerContact)
          .set(values)
          .where(and(eq(customerContact.id, id), eq(customerContact.customerId, customerId)))
          .returning({ id: customerContact.id });
        if (updated.length === 0) throw new NotFoundError("That contact no longer exists");
      } else {
        await tx.insert(customerContact).values({ ...values, customerId });
      }
      await recordAudit(tx, {
        userId: user.id,
        entityType: "customer",
        entityId: customerId,
        action: id ? "update_contact" : "add_contact",
        note: values.name,
      });
    });
    customerPaths(customerId);
  }, "Contact saved");
}

export async function deleteCustomerContact(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.uuid().parse(formData.get("id"));
  const customerId = z.uuid().parse(formData.get("customerId"));
  await getDb().transaction(async (tx) => {
    const deleted = await tx
      .delete(customerContact)
      .where(and(eq(customerContact.id, id), eq(customerContact.customerId, customerId)))
      .returning({ name: customerContact.name });
    if (deleted.length === 0) return;
    await recordAudit(tx, { userId: user.id, entityType: "customer", entityId: customerId, action: "delete_contact", note: deleted[0].name });
  });
  customerPaths(customerId);
}
