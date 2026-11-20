"use client";

import { useActionState } from "react";
import { Field, FormMessage, inputClass, SubmitButton, TextInput } from "@/components/ui/form";
import type { TermsTemplate } from "@/db/schema";
import { deleteTermsTemplate, saveTermsTemplate, setDefaultTermsTemplate } from "@/server/settings";

export function TermsEditor({ template }: { template: TermsTemplate | null }) {
  const [result, action] = useActionState(saveTermsTemplate, null);
  const isNew = template === null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <form action={action} className="flex flex-col gap-4">
        {template ? <input type="hidden" name="id" value={template.id} /> : null}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-medium">{isNew ? "New template" : template.name}</h2>
          {template?.isDefault ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">Default</span> : null}
        </div>
        <FormMessage result={result} />
        <TextInput name="name" label="Name" defaultValue={template?.name ?? ""} required result={result} />
        <Field label="Clauses" name={`clauses-${template?.id ?? "new"}`} hint="One clause per line, printed in this order" error={result && !result.ok ? result.fieldErrors?.clauses : undefined}>
          <textarea
            id={`clauses-${template?.id ?? "new"}`}
            name="clauses"
            rows={Math.max(5, (template?.body.length ?? 0) + 1)}
            defaultValue={template?.body.join("\n") ?? ""}
            className={inputClass}
          />
        </Field>
        {!template?.isDefault ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="makeDefault" /> Use as the default template
          </label>
        ) : null}
        <div>
          <SubmitButton>{isNew ? "Add template" : "Save changes"}</SubmitButton>
        </div>
      </form>
      {template && !template.isDefault ? (
        <form action={deleteTermsTemplate} className="flex gap-2 border-t border-border pt-3">
          <input type="hidden" name="id" value={template.id} />
          <button type="submit" formAction={setDefaultTermsTemplate} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60">
            Make default
          </button>
          <button type="submit" className="rounded-md border border-danger/50 px-3 py-1.5 text-sm text-danger hover:bg-danger/10">
            Delete
          </button>
        </form>
      ) : null}
    </div>
  );
}
