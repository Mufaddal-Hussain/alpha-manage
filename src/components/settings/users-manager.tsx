"use client";

import { Field, FormMessage, inputClass, TextInput } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { UserRole } from "@/db/schema";
import { createUser, resetUserPassword, setUserActive, setUserRole } from "@/server/users";

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

const smallButton = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60 disabled:opacity-60";

function RoleForm({ row, isSelf }: { row: StaffRow; isSelf: boolean }) {
  const { result, pending, onSubmit } = useFormAction(setUserRole);
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <select name="role" aria-label={`Role for ${row.name}`} defaultValue={row.role} disabled={isSelf} className={`${inputClass} w-auto`}>
        <option value="sales">Sales</option>
        <option value="owner">Owner</option>
      </select>
      {isSelf ? null : (
        <button type="submit" disabled={pending} className={smallButton}>
          {pending ? "Saving…" : "Set role"}
        </button>
      )}
      <FormMessage result={result && !result.ok ? result : null} />
    </form>
  );
}

function ActiveForm({ row, isSelf }: { row: StaffRow; isSelf: boolean }) {
  const { result, pending, onSubmit } = useFormAction(setUserActive);
  if (isSelf) return null;
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="active" value={row.active ? "false" : "true"} />
      <button type="submit" disabled={pending} className={row.active ? `${smallButton} border-danger/50 text-danger hover:bg-danger/10` : smallButton}>
        {row.active ? "Deactivate" : "Reactivate"}
      </button>
      <FormMessage result={result && !result.ok ? result : null} />
    </form>
  );
}

function ResetPasswordForm({ row }: { row: StaffRow }) {
  const { result, pending, formRef, onSubmit } = useFormAction(resetUserPassword, { resetOnSuccess: true });
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted hover:text-foreground">Reset password</summary>
      <form ref={formRef} onSubmit={onSubmit} className="mt-3 flex flex-col gap-3" noValidate>
        <input type="hidden" name="id" value={row.id} />
        <FormMessage result={result} />
        <TextInput
          id={`${row.id}-password`}
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters. Tell the user; it is not shown again."
          result={result}
        />
        <div>
          <button type="submit" disabled={pending} className={smallButton}>
            {pending ? "Saving…" : "Reset password"}
          </button>
        </div>
      </form>
    </details>
  );
}

export function UsersManager({ users, currentUserId }: { users: StaffRow[]; currentUserId: string }) {
  return (
    <ul className="flex flex-col gap-3">
      {users.map((row) => {
        const isSelf = row.id === currentUserId;
        return (
          <li key={row.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                {row.name}
                {isSelf ? <span className="ml-2 text-xs font-normal text-muted">(you)</span> : null}
                {!row.active ? <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted">Inactive</span> : null}
              </p>
              <p className="text-sm text-muted">{row.email}</p>
            </div>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <RoleForm row={row} isSelf={isSelf} />
              <ActiveForm row={row} isSelf={isSelf} />
            </div>
            <ResetPasswordForm row={row} />
          </li>
        );
      })}
    </ul>
  );
}

export function NewUserForm() {
  const { result, pending, formRef, onSubmit } = useFormAction(createUser, { resetOnSuccess: true });
  const roleError = result && !result.ok ? result.fieldErrors?.role : undefined;
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4" noValidate>
      <h2 className="text-lg font-medium">Add a user</h2>
      <FormMessage result={result} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput name="name" label="Name" required result={result} />
        <TextInput name="email" label="Email" type="email" autoComplete="off" required result={result} />
        <TextInput name="password" label="Password" type="password" autoComplete="new-password" hint="At least 10 characters. Tell the user; it is not shown again." required result={result} />
        <Field label="Role" name="role" error={roleError}>
          <select id="role" name="role" defaultValue="sales" className={inputClass}>
            <option value="sales">Sales: customers, quotations, orders, challans</option>
            <option value="owner">Owner: everything, including settings and users</option>
          </select>
        </Field>
      </div>
      <div>
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
          {pending ? "Saving…" : "Create user"}
        </button>
      </div>
    </form>
  );
}
