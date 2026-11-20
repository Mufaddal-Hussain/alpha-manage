"use client";

import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/errors";

export const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-60";

export function Field({
  label,
  name,
  hint,
  error,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  name,
  label,
  hint,
  result,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  name: string;
  label: string;
  hint?: string;
  result?: ActionResult<unknown> | null;
}) {
  const error = result && !result.ok ? result.fieldErrors?.[name] : undefined;
  // Pages with several forms pass distinct ids; the label always points at the input's real id.
  const id = props.id ?? name;
  return (
    <Field label={label} name={id} hint={hint} error={error}>
      <input id={id} name={name} className={inputClass} aria-invalid={error ? true : undefined} {...props} />
    </Field>
  );
}

export function SubmitButton({ children, pendingLabel = "Saving…" }: { children: React.ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Success / error banner for a server-action result. */
export function FormMessage({ result }: { result: ActionResult<unknown> | null }) {
  if (!result) return null;
  if (result.ok) {
    return result.message ? (
      <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
        {result.message}
      </p>
    ) : null;
  }
  return (
    <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {result.message}
    </p>
  );
}
