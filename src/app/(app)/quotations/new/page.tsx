import Link from "next/link";
import { QuotationEditor } from "@/components/quotations/quotation-editor";
import { requireUser } from "@/lib/auth/session";
import { listChargeTypes } from "@/server/product-queries";
import { getEditorSettings } from "@/server/quotation-queries";

export const metadata = { title: "New quotation · alpha-Manage" };

export default async function NewQuotationPage() {
  await requireUser();
  const [settings, chargeTypes] = await Promise.all([getEditorSettings(), listChargeTypes()]);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/quotations" className="tap text-sm text-muted hover:underline">
          ← Quotations
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New quotation</h1>
        <p className="mt-1 text-sm text-muted">Pick the customer, add items and charges, then issue it to get the number and the PDF.</p>
      </div>
      <QuotationEditor
        settings={settings}
        chargeTypes={chargeTypes.map((c) => ({ id: c.id, name: c.name, hsnSacCode: c.hsnSacCode, gstRate: c.gstRate }))}
        initial={null}
      />
    </div>
  );
}
