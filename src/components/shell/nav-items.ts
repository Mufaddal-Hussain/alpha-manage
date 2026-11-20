import type { UserRole } from "@/db/schema";
import { roleAllows } from "@/lib/auth/roles";

export interface NavItem {
  href: string;
  label: string;
  /** Roles that see the item (the owner sees everything). Authorization is still enforced by the page/action. */
  roles: readonly UserRole[];
  group?: string;
}

// Later phases append their screens here (catalog, quotations, orders, challans).
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Dashboard", roles: ["sales"] },
  { href: "/customers", label: "Customers", roles: ["sales"] },
  { href: "/settings/business", label: "Business profile", roles: ["owner"], group: "Settings" },
  { href: "/settings/numbering", label: "Numbering", roles: ["owner"], group: "Settings" },
  { href: "/settings/terms", label: "Terms", roles: ["sales"], group: "Settings" },
  { href: "/settings/users", label: "Users", roles: ["owner"], group: "Settings" },
];

export function navFor(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => roleAllows(role, item.roles));
}
