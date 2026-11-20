import { CustomerForm } from "@/components/customers/customer-form";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "New customer · alpha-Manage" };

export default async function NewCustomerPage() {
  await requireUser();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New customer</h1>
        <p className="mt-1 text-sm text-muted">Shipping addresses and site contacts can be added once the customer is saved.</p>
      </div>
      <CustomerForm customer={null} />
    </div>
  );
}
