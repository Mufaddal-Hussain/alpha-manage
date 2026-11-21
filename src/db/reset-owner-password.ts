import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { and, eq } from "drizzle-orm";

// Resets the owner's password to a new generated one and signs the owner out everywhere.
// Run with `npm run db:reset-owner-password`. The new password is printed once and stored nowhere.
// Optional: OWNER_EMAIL=... to pick the owner when there is more than one.
loadEnvConfig(process.cwd());

async function main() {
  const { getDb } = await import("@/db");
  const { account, session, user } = await import("@/db/schema");
  const { recordAudit } = await import("@/lib/audit");
  const { getAuth } = await import("@/lib/auth");

  const db = getDb();
  const wanted = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const owners = await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.role, "owner"));
  const owner = wanted ? owners.find((o) => o.email === wanted) : owners[0];
  if (!owner) throw new Error(wanted ? `No owner with email ${wanted}` : "No owner user exists; run npm run db:seed first");
  if (!wanted && owners.length > 1) throw new Error("More than one owner; set OWNER_EMAIL");

  const password = randomBytes(18).toString("base64url");
  const hash = await (await getAuth().$context).password.hash(password);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(account)
      .set({ password: hash })
      .where(and(eq(account.userId, owner.id), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    if (updated.length === 0) throw new Error("The owner has no password login to reset");
    await tx.delete(session).where(eq(session.userId, owner.id));
    await recordAudit(tx, { userId: null, entityType: "user", entityId: owner.id, action: "password_reset", note: "script" });
  });

  console.log(`Password reset for ${owner.email}. Other sessions were signed out.`);
  console.log(`  password: ${password}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Reset failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
