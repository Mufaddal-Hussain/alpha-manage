import { getAuth } from "@/lib/auth";
import type { UserRole } from "@/db/schema";

export interface NewStaffUser {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

/**
 * Creates a staff account with a credential login. Public sign-up is disabled, so this is
 * the only way users appear: the seed uses it for the owner, the owner's users screen for staff.
 * Callers must have authorised the request (requireRole("owner")) before calling.
 */
export async function createStaffUser(input: NewStaffUser): Promise<{ id: string; email: string }> {
  const ctx = await getAuth().$context;
  const email = input.email.trim().toLowerCase();
  if (await ctx.internalAdapter.findUserByEmail(email)) {
    throw new Error(`A user with email ${email} already exists`);
  }
  const passwordHash = await ctx.password.hash(input.password);
  const user = await ctx.internalAdapter.createUser(
    {
      name: input.name.trim(),
      email,
      emailVerified: true,
      role: input.role,
      active: true,
    },
    { method: "admin" },
  );
  await ctx.internalAdapter.linkAccount({
    providerId: "credential",
    accountId: user.id,
    userId: user.id,
    password: passwordHash,
  });
  return { id: user.id, email };
}
