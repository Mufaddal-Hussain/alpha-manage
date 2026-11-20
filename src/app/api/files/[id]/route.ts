import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/db";
import { file } from "@/db/schema";
import { authorizeRequest } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/files/[id]: session required; streams from storage; never exposes a storage URL.
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const auth = await authorizeRequest();
  if (auth.response) return auth.response;

  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });

  const [row] = await getDb().select().from(file).where(eq(file.id, id)).limit(1);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  // Phase 2 only stores the business logo and brand strip, which every signed-in staff member may see.
  // When PO attachments and import sources arrive, check the owning record here and answer 403.

  const stored = await getStorage().get(row.storageKey);
  if (!stored) return Response.json({ error: "Not found" }, { status: 404 });

  return new Response(stored.stream, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(stored.size ?? row.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
      // Stored files are untrusted uploads: never sniff or execute them.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-cache",
    },
  });
}
