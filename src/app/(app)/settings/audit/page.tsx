import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { AUDIT_PAGE_SIZE, getAuditFilterOptions, listAuditEntries } from "@/server/audit-queries";

export const metadata = { title: "Audit log · alpha-Manage" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const field = "rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const WHEN = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** Where a record of this type can be opened, when there is such a page. */
const ENTITY_PATHS: Record<string, string> = {
  quotation: "/quotations",
  purchase_order: "/orders",
  delivery_challan: "/challans",
  customer: "/customers",
  product: "/catalog/products",
};

const ENTITY_LABELS: Record<string, string> = {
  quotation: "Quotation",
  purchase_order: "Purchase order",
  delivery_challan: "Challan",
  customer: "Customer",
  product: "Product",
  brand: "Brand",
  distributor: "Distributor",
  user: "User",
  terms_template: "Terms template",
};

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function label(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType.replace(/_/g, " ");
}

export default async function AuditLogPage({ searchParams }: PageProps<"/settings/audit">) {
  await requireRole("owner");
  const params = await searchParams;
  const options = await getAuditFilterOptions();
  const entityType = options.entityTypes.find((t) => t === one(params.type)) ?? "";
  const action = options.actions.find((a) => a === one(params.action)) ?? "";
  const from = ISO_DATE.test(one(params.from)) ? one(params.from) : "";
  const to = ISO_DATE.test(one(params.to)) ? one(params.to) : "";
  const page = Math.max(1, Number.parseInt(one(params.page), 10) || 1);
  const { rows, hasNext } = await listAuditEntries({ entityType: entityType || undefined, action: action || undefined, from: from || undefined, to: to || undefined, page });
  const filtered = Boolean(entityType || action || from || to);

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (entityType) query.set("type", entityType);
    if (action) query.set("action", action);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/settings/audit?${text}` : "/settings/audit";
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-muted">
          Every create, status change, override and settings change, with who did it and when (India time). Entries are never edited or deleted.
        </p>
      </div>

      <form method="get" action="/settings/audit" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select name="type" defaultValue={entityType} aria-label="Record type" className={field}>
          <option value="">Any record type</option>
          {options.entityTypes.map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </select>
        <select name="action" defaultValue={action} aria-label="Action" className={field}>
          <option value="">Any action</option>
          {options.actions.map((a) => (
            <option key={a} value={a}>
              {a.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          From
          <input type="date" name="from" defaultValue={from} aria-label="From date" className={`${field} min-w-0 flex-1`} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          To
          <input type="date" name="to" defaultValue={to} aria-label="To date" className={`${field} min-w-0 flex-1`} />
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-border/60">
            Filter
          </button>
          {filtered ? (
            <Link href="/settings/audit" className="tap text-sm text-muted hover:underline">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          {filtered ? "No entries match these filters." : "Nothing has been logged yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="stack w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">Record</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Change</th>
                <th className="px-4 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const path = ENTITY_PATHS[r.entityType];
                return (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">{WHEN.format(r.createdAt)}</td>
                    <td data-label="Who" className="px-4 py-3">{r.userName ?? "System"}</td>
                    <td data-label="Record" className="px-4 py-3">
                      {path && r.action !== "delete" ? (
                        <Link href={`${path}/${r.entityId}`} className="hover:underline">
                          {label(r.entityType)}
                        </Link>
                      ) : (
                        label(r.entityType)
                      )}
                    </td>
                    <td data-label="Action" className="px-4 py-3 whitespace-nowrap">{r.action.replace(/_/g, " ")}</td>
                    <td data-label="Change" className="px-4 py-3 whitespace-nowrap">
                      {r.fromStatus || r.toStatus ? `${r.fromStatus ?? "–"} → ${r.toStatus ?? "–"}` : "–"}
                    </td>
                    <td data-label="Note" className="px-4 py-3 break-words">{r.note ?? "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {page > 1 || hasNext ? (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="tap text-accent hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {page} ({AUDIT_PAGE_SIZE} per page)
          </span>
          {hasNext ? (
            <Link href={pageHref(page + 1)} className="tap text-accent hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
