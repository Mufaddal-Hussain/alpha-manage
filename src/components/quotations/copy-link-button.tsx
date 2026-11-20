"use client";

import { useState } from "react";

/** Copies the absolute URL of a PDF (FR-019). The link needs a staff sign-in, so it is for sharing inside the business. */
export function CopyLinkButton({ path }: { path: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2500);
      }}
    >
      {state === "copied" ? "Link copied" : state === "failed" ? "Could not copy" : "Copy PDF link"}
    </button>
  );
}
