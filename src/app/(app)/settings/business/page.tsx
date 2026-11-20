import { requireRole } from "@/lib/auth/session";
import { BusinessForm } from "@/components/settings/business-form";
import { getBusinessProfile, listTermsTemplates } from "@/server/settings-queries";

export const metadata = { title: "Business profile · alpha-Manage" };

export default async function BusinessSettingsPage() {
  await requireRole("owner");
  const [profile, templates] = await Promise.all([getBusinessProfile(), listTermsTemplates()]);
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Business profile</h1>
        <p className="mt-1 text-sm text-muted">Printed on every quotation and challan. GSTIN and state decide intra- or inter-state tax.</p>
      </div>
      <BusinessForm profile={profile} templates={templates} />
    </>
  );
}
