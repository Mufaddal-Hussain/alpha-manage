import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeNextPath } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in · alpha-Manage" };

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">alpha-Manage</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mb-6 mt-1 text-sm text-muted">Staff only. Ask the owner if you need an account.</p>
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
          <SignInContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function SignInContent({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;

  // A real session (not just a cookie) skips the form.
  if (await getCurrentUser()) redirect(safeNextPath(nextPath));

  return <SignInForm next={nextPath} />;
}
