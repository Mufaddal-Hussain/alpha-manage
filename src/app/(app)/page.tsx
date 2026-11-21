import Link from "next/link";
import { PoStatusBadge } from "@/components/orders/po-status-badge";
import { StatusBadge } from "@/components/quotations/status-badge";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatRupees } from "@/lib/format";
import { EXPIRING_SOON_DAYS, getDashboard, type DashboardData } from "@/server/dashboard-queries";

export const metadata = { title: "Dashboard · alpha-Manage" };

const card = "rounded-lg border border-border bg-surface";
const rowLink = "flex flex-col gap-1 px-4 py-3 hover:bg-border/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4";

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboard();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user.name}</h1>
          <p className="mt-1 text-sm text-muted">What needs attention today, {formatDate(data.today)}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/quotations/new" className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
            New quotation
          </Link>
          <Link href="/challans/new" className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm hover:bg-border/60">
            New challan
          </Link>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Summary">
        <Stat label="Open quotations" value={data.openQuotations.awaitingDecision} hint={`${data.openQuotations.drafts} draft${data.openQuotations.drafts === 1 ? "" : "s"} in progress`} href="/quotations?status=sent" />
        <Stat label="Expiring soon" value={data.expiringSoon.count} hint={`valid-until within ${EXPIRING_SOON_DAYS} days`} href="/quotations?status=sent" tone={data.expiringSoon.count > 0 ? "warn" : undefined} />
        <Stat label="POs to deliver" value={data.pendingDeliveries.count} hint="open or partly delivered" href="/orders" />
      </ul>

      <QuotationSection
        title="Open quotations"
        empty="No quotations are waiting for a decision."
        rows={data.openQuotations.rows}
        total={data.openQuotations.awaitingDecision}
        more="/quotations?status=sent"
      />
      <QuotationSection
        title="Expiring soon"
        empty={`Nothing expires in the next ${EXPIRING_SOON_DAYS} days.`}
        rows={data.expiringSoon.rows}
        total={data.expiringSoon.count}
        more="/quotations?status=sent"
        showDaysLeft={data.today}
      />

      <section aria-labelledby="deliveries-heading" className="flex flex-col gap-2">
        <h2 id="deliveries-heading" className="text-lg font-semibold">
          POs with pending deliveries
        </h2>
        {data.pendingDeliveries.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">Every PO is fully delivered.</p>
        ) : (
          <ul className={`${card} divide-y divide-border`}>
            {data.pendingDeliveries.rows.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className={rowLink}>
                  <span className="min-w-0">
                    <span className="block font-medium">{o.customerPoNumber}</span>
                    <span className="block truncate text-sm text-muted">
                      {o.customerName} · {o.quotationNumber} · PO dated {formatDate(o.poDate)}
                    </span>
                  </span>
                  <span className="flex flex-none items-center gap-3 text-sm">
                    <span className="tabular-nums text-muted">
                      {o.pendingLines} of {o.lineCount} line{o.lineCount === 1 ? "" : "s"} pending
                    </span>
                    <PoStatusBadge status={o.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data.pendingDeliveries.count > data.pendingDeliveries.rows.length ? (
          <Link href="/orders" className="tap text-sm text-accent hover:underline">
            See all {data.pendingDeliveries.count} purchase orders
          </Link>
        ) : null}
      </section>

      {user.role === "owner" ? (
        <section aria-labelledby="owner-heading" className="flex flex-col gap-2">
          <h2 id="owner-heading" className="text-lg font-semibold">
            Owner
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { href: "/settings/business", title: "Business profile", text: "Name, GSTIN, address, logo, bank details" },
              { href: "/settings/numbering", title: "Numbering", text: "Quotation and challan number formats" },
              { href: "/settings/terms", title: "Terms", text: "Standard terms printed on documents" },
              { href: "/settings/users", title: "Users", text: "Staff accounts, roles and passwords" },
              { href: "/settings/audit", title: "Audit log", text: "Who changed what, and when" },
            ].map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={`block h-full ${card} p-4 hover:border-accent`}>
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 text-sm text-muted">{item.text}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint, href, tone }: { label: string; value: number; hint: string; href: string; tone?: "warn" }) {
  return (
    <li>
      <Link href={href} className={`block ${card} p-4 hover:border-accent`}>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className={`mt-1 text-3xl font-semibold tabular-nums ${tone === "warn" ? "text-danger" : ""}`}>{value}</p>
        <p className="mt-1 text-sm text-muted">{hint}</p>
      </Link>
    </li>
  );
}

type QuotationRow = DashboardData["openQuotations"]["rows"][number];

function QuotationSection({
  title,
  empty,
  rows,
  total,
  more,
  showDaysLeft,
}: {
  title: string;
  empty: string;
  rows: QuotationRow[];
  total: number;
  more: string;
  /** Today's date (YYYY-MM-DD): when given, each row says how many days are left. */
  showDaysLeft?: string;
}) {
  const id = `${title.toLowerCase().replace(/\s+/g, "-")}-heading`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className={`${card} divide-y divide-border`}>
          {rows.map((q) => (
            <li key={q.id}>
              <Link href={`/quotations/${q.id}`} className={rowLink}>
                <span className="min-w-0">
                  <span className="block font-medium">
                    {q.number} <span className="font-normal text-muted">rev {q.revisionNo}</span>
                  </span>
                  <span className="block truncate text-sm text-muted">{q.customerName}</span>
                </span>
                <span className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="tabular-nums">{formatRupees(q.grandTotal)}</span>
                  <span className="text-muted">
                    {showDaysLeft ? daysLeft(q.validUntil, showDaysLeft) : `valid until ${formatDate(q.validUntil)}`}
                  </span>
                  <StatusBadge status={q.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {total > rows.length ? (
        <Link href={more} className="tap text-sm text-accent hover:underline">
          See all {total}
        </Link>
      ) : null}
    </section>
  );
}

function daysLeft(validUntil: string, today: string): string {
  const days = Math.round((Date.parse(validUntil) - Date.parse(today)) / 86_400_000);
  if (days <= 0) return "last day today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}
