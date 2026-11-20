import { TermsEditor } from "@/components/settings/terms-editor";
import { requireUser } from "@/lib/auth/session";
import { listTermsTemplates } from "@/server/settings-queries";

export const metadata = { title: "Terms · alpha-Manage" };

export default async function TermsSettingsPage() {
  const user = await requireUser();
  const templates = await listTermsTemplates();
  const canEdit = user.role === "owner";
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Terms</h1>
        <p className="mt-1 text-sm text-muted">Standard terms and conditions printed on quotations. The default is used for new quotations.</p>
      </div>
      {canEdit ? (
        <>
          {templates.map((t) => (
            <TermsEditor key={t.id} template={t} />
          ))}
          <TermsEditor template={null} />
        </>
      ) : (
        templates.map((t) => (
          <section key={t.id} className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-lg font-medium">
              {t.name} {t.isDefault ? <span className="text-xs text-muted">(default)</span> : null}
            </h2>
            <ol className="mt-2 list-decimal pl-5 text-sm">
              {t.body.map((clause, i) => (
                <li key={i}>{clause}</li>
              ))}
            </ol>
          </section>
        ))
      )}
    </>
  );
}
