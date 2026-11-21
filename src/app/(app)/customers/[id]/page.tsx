import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AddressSection } from "@/components/customers/address-section";
import { ContactSection } from "@/components/customers/contact-section";
import { CustomerForm } from "@/components/customers/customer-form";
import { requireUser } from "@/lib/auth/session";
import { getCustomerDetail } from "@/server/customer-queries";
import { setCustomerActive } from "@/server/customers";

export const metadata = { title: "Customer · alpha-Manage" };

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();
  const { customer, addresses, contacts } = detail;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <Link href="/customers" className="tap text-sm text-muted hover:underline">
          ← Customers
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {customer.displayName}
            {!customer.active ? <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted">Inactive</span> : null}
          </h1>
          <form action={setCustomerActive}>
            <input type="hidden" name="id" value={customer.id} />
            <input type="hidden" name="active" value={customer.active ? "false" : "true"} />
            <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60">
              {customer.active ? "Deactivate" : "Reactivate"}
            </button>
          </form>
        </div>
      </div>
      <CustomerForm customer={customer} />
      <AddressSection customerId={customer.id} addresses={addresses} defaultStateCode={customer.stateCode} />
      <ContactSection customerId={customer.id} contacts={contacts} />
    </div>
  );
}
