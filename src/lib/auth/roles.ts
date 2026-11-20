import type { UserRole } from "@/db/schema";

/**
 * Role check shared by the data layer and the UI. The owner can do everything; any
 * other role needs to be listed explicitly (contracts/ui-routes.md).
 */
export function roleAllows(role: string | null | undefined, allowed: readonly UserRole[]): boolean {
  if (role === "owner") return true;
  return allowed.some((candidate) => candidate === role);
}

/** Post-sign-in redirect target; only same-site paths are honoured (no open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (next === "/sign-in" || next.startsWith("/sign-in?")) return "/";
  return next;
}
