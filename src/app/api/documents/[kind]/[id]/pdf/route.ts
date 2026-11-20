import type { NextRequest } from "next/server";
import { getDb } from "@/db";
import { authorizeRequest } from "@/lib/auth/session";
import { getQuotationPdf } from "@/server/quotation-pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/documents/quotation/[id]/pdf (contracts/http-endpoints.md). Session required; Node runtime (the default
// for route handlers, and what @react-pdf/renderer needs). `challan` is served by the challan phase.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/documents/[kind]/[id]/pdf">) {
  const auth = await authorizeRequest();
  if (auth.response) return auth.response;

  const { kind, id } = await ctx.params;
  if (kind !== "quotation" || !UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });

  const q = request.nextUrl.searchParams;
  const revisionParam = q.get("revision");
  if (revisionParam !== null && !/^[1-9]\d{0,3}$/.test(revisionParam)) return Response.json({ error: "Not found" }, { status: 404 });
  const layoutParam = q.get("layout");
  if (layoutParam !== null && layoutParam !== "gst_quotation" && layoutParam !== "estimate") {
    return Response.json({ error: "layout must be gst_quotation or estimate" }, { status: 400 });
  }

  const result = await getQuotationPdf(getDb(), id, {
    revisionNo: revisionParam === null ? undefined : Number(revisionParam),
    layout: layoutParam ?? undefined,
    preview: q.get("preview") === "1",
  });
  if (result.status === "not_found") return Response.json({ error: "Not found" }, { status: 404 });
  if (result.status === "draft") {
    return Response.json({ error: "This quotation has not been issued yet; add ?preview=1 for a watermarked draft" }, { status: 409 });
  }

  const disposition = q.get("download") === "1" ? "attachment" : "inline";
  return new Response(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(result.bytes.length),
      "Content-Disposition": `${disposition}; filename="${result.fileName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
