import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { UserRole } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { roleAllows } from "@/lib/auth/roles";

/**
 * Authorization lives here, in the data layer. Every server action, page that reads data and route
 * handler calls one of these first; `src/proxy.ts` only redirects optimistically.
 */

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

/** The signed-in, active user for this request, or null. Looked up once per request. */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  // Read request headers first: during prerendering this is what defers the work to request time.
  const requestHeaders = await headers();
  const result = await getAuth().api.getSession({ headers: requestHeaders });
  if (!result) return null;
  const { user } = result;
  // Deactivated staff are locked out immediately, even with a live session.
  if (!user.active) return null;
  const role: UserRole = user.role === "owner" ? "owner" : "sales";
  return { id: user.id, name: user.name, email: user.email, role };
});

/** For pages and server actions: redirects to the sign-in page when nobody is signed in. */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/**
 * For pages and server actions: signed-in user whose role is allowed (the owner always is);
 * everyone else is sent to the access-denied page.
 */
export async function requireRole(...allowed: UserRole[]): Promise<AppUser> {
  const user = await requireUser();
  if (!roleAllows(user.role, allowed)) redirect("/forbidden");
  return user;
}

/**
 * For route handlers, which answer with status codes instead of redirects:
 * 401 when signed out, 403 when the role is not allowed (contracts/http-endpoints.md).
 */
export async function authorizeRequest(
  ...allowed: UserRole[]
): Promise<{ user: AppUser; response?: undefined } | { user?: undefined; response: Response }> {
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: "Not signed in" }, { status: 401 }) };
  if (allowed.length > 0 && !roleAllows(user.role, allowed)) {
    return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}
