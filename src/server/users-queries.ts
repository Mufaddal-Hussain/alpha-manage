import { asc, desc } from "drizzle-orm";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import { requireRole } from "@/lib/auth/session";

/** Staff accounts for the owner's users screen. Owner only. */
export async function listUsers() {
  await requireRole("owner");
  return getDb()
    .select({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active, createdAt: user.createdAt })
    .from(user)
    .orderBy(desc(user.active), asc(user.name));
}
