import type { UserRole } from "@/db/schema";
import { istDate } from "@/lib/quotation/status";

/**
 * Why this person may not cancel the challan, or null when they may (contracts/ui-routes.md): the owner can cancel any
 * issued challan; sales staff only their own, on the day it was issued. Used by the domain operation (which enforces it)
 * and by the challan page (which only decides whether to show the form).
 */
export function cancelRefusal(
  role: UserRole,
  actorId: string,
  challan: { status: "issued" | "cancelled"; createdBy: string | null; createdAt: Date; number: string },
  now: Date,
): string | null {
  if (challan.status === "cancelled") return `Challan ${challan.number} is already cancelled`;
  if (role === "owner") return null;
  if (challan.createdBy !== actorId) return "Only the owner can cancel a challan that someone else issued";
  if (istDate(challan.createdAt) !== istDate(now)) return "Only the owner can cancel a challan after the day it was issued";
  return null;
}
