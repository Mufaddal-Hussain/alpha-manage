import { Suspense } from "react";
import { ShellNav } from "@/components/shell/shell-nav";
import { navFor } from "@/components/shell/nav-items";
import { requireUser } from "@/lib/auth/session";

// The whole app sits behind sign-in, so entering it may block on the session read; opt this shared layout
// out of instant-navigation validation (the pages below still stream behind loading.tsx).
export const instant = false;

// Everything in the app needs the session, which is a request-time read. It sits behind this one
// boundary (Cache Components), and each page below can read data freely inside it.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Loading…</p>}>
      <AuthedShell>{children}</AuthedShell>
    </Suspense>
  );
}

async function AuthedShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <ShellNav items={navFor(user.role)} userName={user.name} roleLabel={user.role} />
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
