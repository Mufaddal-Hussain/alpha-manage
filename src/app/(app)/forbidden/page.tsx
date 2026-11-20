import Link from "next/link";

export const metadata = { title: "No access · alpha-Manage" };

export default function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-md pt-12 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-danger">403</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">You do not have access to this page</h1>
      <p className="mt-2 text-sm text-muted">This screen is for the owner. If you need it, ask the owner.</p>
      <Link href="/" className="mt-6 inline-block rounded-md border border-border px-4 py-2 text-sm hover:bg-border/60">
        Back to the dashboard
      </Link>
    </div>
  );
}
