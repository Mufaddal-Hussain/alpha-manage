import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { QuotationEditor } from "@/components/quotations/quotation-editor";
import { requireUser } from "@/lib/auth/session";
import { initialFromRevision } from "@/lib/quotation/editor-state";
import { listChargeTypes } from "@/server/product-queries";
import { getEditorSettings, getQuotation } from "@/server/quotation-queries";
import { ReviseStarter } from "@/components/quotations/status-actions";

export const metadata = { title: "Revise quotation · alpha-Manage" };

/**
 * Edits the draft of a quotation: a brand-new draft, a duplicate, or revision n+1 after "Revise".
 * A sent, rejected or expired quotation shows a button to start the revision; an approved one cannot be revised.
 */
export default async function ReviseQuotationPage({ params }: PageProps<"/quotations/[id]/revise">) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await getQuotation(id);
  if (!detail) notFound();
  const { quotation, current, lines } = detail;
  if (quotation.status === "approved") redirect(`/quotations/${id}`);

  const back = (
    <Link href={`/quotations/${id}`} className="text-sm text-muted hover:underline">
      ← {quotation.number ?? "Draft quotation"}
    </Link>
  );

  if (quotation.status !== "draft") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">Revise {quotation.number}</h1>
        <p className="text-sm text-muted">
          Revision {current.revisionNo} stays as it was issued. Starting a revision makes an editable copy as revision {current.revisionNo + 1}; the number stays {quotation.number}.
        </p>
        <ReviseStarter quotationId={id} />
      </div>
    );
  }

  const [settings, chargeTypes] = await Promise.all([getEditorSettings(), listChargeTypes()]);
  const initial = initialFromRevision({
    quotationId: id,
    number: quotation.number,
    customer: { id: quotation.customerId, displayName: detail.customerName },
    revision: current,
    lines,
  });
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        {back}
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {quotation.number ? `Revise ${quotation.number}` : "Edit draft quotation"}
          {quotation.number ? <span className="ml-2 text-base font-normal text-muted">revision {current.revisionNo}</span> : null}
        </h1>
      </div>
      <QuotationEditor
        settings={settings}
        chargeTypes={chargeTypes.map((c) => ({ id: c.id, name: c.name, hsnSacCode: c.hsnSacCode, gstRate: c.gstRate }))}
        initial={initial}
      />
    </div>
  );
}
