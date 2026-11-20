"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { session, user } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { createStaffUser } from "@/lib/auth/create-user";
import { requireRole } from "@/lib/auth/session";
import { ConflictError, NotFoundError, runAction, ValidationError, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/form";

// Staff user management (T036). Owner only: every action calls requireRole("owner") before anything else.

const role = z.enum(["owner", "sales"], "Choose a role");
const password = z.string().min(10, "At least 10 characters").max(128, "At most 128 characters");

const createSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email").max(160)),
  password,
  role,
});

const roleSchema = z.object({ id: z.uuid(), role });
const activeSchema = z.object({ id: z.uuid(), active: z.enum(["true", "false"]).transform((v) => v === "true") });
const resetSchema = z.object({ id: z.uuid(), password });

export async function createUser(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireRole("owner");
    const values = parseForm(createSchema, formData);
    const [existing] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, values.email)).limit(1);
    if (existing) throw new ValidationError("Please fix the highlighted fields", { email: "A user with this email already exists" });
    const created = await createStaffUser(values);
    await recordAudit(getDb(), { userId: actor.id, entityType: "user", entityId: created.id, action: "create", note: `${values.email} as ${values.role}` });
    revalidatePath("/settings/users");
  }, "User created. Give them the password you set; they can sign in now.");
}

export async function setUserRole(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireRole("owner");
    const { id, role: newRole } = parseForm(roleSchema, formData);
    // Prevents the owner locking everyone out of owner-only screens by demoting their own account.
    if (id === actor.id) throw new ConflictError("You cannot change your own role");
    await getDb().transaction(async (tx) => {
      const [target] = await tx.select({ role: user.role }).from(user).where(eq(user.id, id)).for("update");
      if (!target) throw new NotFoundError("That user no longer exists");
      if (target.role === newRole) return;
      await tx.update(user).set({ role: newRole }).where(eq(user.id, id));
      await recordAudit(tx, { userId: actor.id, entityType: "user", entityId: id, action: "set_role", fromStatus: target.role, toStatus: newRole });
    });
    revalidatePath("/settings/users");
  }, "Role updated");
}

export async function setUserActive(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireRole("owner");
    const { id, active } = parseForm(activeSchema, formData);
    if (id === actor.id) throw new ConflictError("You cannot deactivate your own account");
    await getDb().transaction(async (tx) => {
      const [target] = await tx.select({ active: user.active }).from(user).where(eq(user.id, id)).for("update");
      if (!target) throw new NotFoundError("That user no longer exists");
      await tx.update(user).set({ active }).where(eq(user.id, id));
      // A deactivated user is signed out everywhere straight away.
      if (!active) await tx.delete(session).where(eq(session.userId, id));
      await recordAudit(tx, { userId: actor.id, entityType: "user", entityId: id, action: active ? "reactivate" : "deactivate" });
    });
    revalidatePath("/settings/users");
  }, "Saved");
}

export async function resetUserPassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireRole("owner");
    const { id, password: newPassword } = parseForm(resetSchema, formData);
    const [target] = await getDb().select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
    if (!target) throw new NotFoundError("That user no longer exists");
    const ctx = await getAuth().$context;
    await ctx.internalAdapter.updatePassword(id, await ctx.password.hash(newPassword));
    // Anyone holding the old password is signed out; the person is told the new one by the owner.
    await getDb().delete(session).where(eq(session.userId, id));
    await recordAudit(getDb(), { userId: actor.id, entityType: "user", entityId: id, action: "reset_password" });
    revalidatePath("/settings/users");
  }, "Password reset. Give the new password to the user.");
}
