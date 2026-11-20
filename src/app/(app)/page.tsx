import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata = { title: "Dashboard · alpha-Manage" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user?.name}</h1>
        <p className="mt-1 text-sm text-muted">
          Quotations, customers and deliveries will appear here as they are built. For now you can set up the business.
        </p>
      </div>
      {user?.role === "owner" ? (
        <ul className="grid gap-3 sm:grid-cols-3">
          {[
            { href: "/settings/business", title: "Business profile", text: "Name, GSTIN, address, logo, bank details" },
            { href: "/settings/numbering", title: "Numbering", text: "Quotation and challan number formats" },
            { href: "/settings/terms", title: "Terms", text: "Standard terms printed on documents" },
          ].map((card) => (
            <li key={card.href}>
              <Link href={card.href} className="block h-full rounded-lg border border-border bg-surface p-4 hover:border-accent">
                <p className="font-medium">{card.title}</p>
                <p className="mt-1 text-sm text-muted">{card.text}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
