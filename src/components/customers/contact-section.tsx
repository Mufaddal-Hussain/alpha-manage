"use client";

import { FormMessage, TextInput } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { CustomerContact } from "@/db/schema";
import { deleteCustomerContact, saveCustomerContact } from "@/server/customers";

function ContactForm({ customerId, contact }: { customerId: string; contact: CustomerContact | null }) {
  const { result, pending, formRef, onSubmit } = useFormAction(saveCustomerContact, { resetOnSuccess: contact === null });
  const idPrefix = contact?.id ?? "new-contact";
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="id" value={contact?.id ?? ""} />
      <FormMessage result={result} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput id={`${idPrefix}-name`} name="name" label="Name" defaultValue={contact?.name ?? ""} required result={result} />
        <TextInput id={`${idPrefix}-role`} name="role" label="Role" hint="For example Site engineer" defaultValue={contact?.role ?? ""} result={result} />
        <TextInput id={`${idPrefix}-phone`} name="phone" label="Phone" type="tel" defaultValue={contact?.phone ?? ""} result={result} />
        <TextInput id={`${idPrefix}-email`} name="email" label="Email" type="email" defaultValue={contact?.email ?? ""} result={result} />
      </div>
      <div>
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
          {pending ? "Saving…" : contact ? "Save contact" : "Add contact"}
        </button>
      </div>
    </form>
  );
}

export function ContactSection({ customerId, contacts }: { customerId: string; contacts: CustomerContact[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Contacts</h2>
      {contacts.length === 0 ? <p className="text-sm text-muted">No contact persons yet.</p> : null}
      {contacts.map((c) => (
        <details key={c.id} className="rounded-lg border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {c.name}
            <span className="ml-2 font-normal text-muted">{[c.role, c.phone, c.email].filter(Boolean).join(" · ")}</span>
          </summary>
          <div className="mt-4 flex flex-col gap-3">
            <ContactForm customerId={customerId} contact={c} />
            <form action={deleteCustomerContact} className="border-t border-border pt-3">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="customerId" value={customerId} />
              <button type="submit" className="rounded-md border border-danger/50 px-3 py-1.5 text-sm text-danger hover:bg-danger/10">
                Delete contact
              </button>
            </form>
          </div>
        </details>
      ))}
      <details className="rounded-lg border border-dashed border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">Add a contact</summary>
        <div className="mt-4">
          <ContactForm customerId={customerId} contact={null} />
        </div>
      </details>
    </section>
  );
}
