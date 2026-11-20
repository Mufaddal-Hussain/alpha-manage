import { authorizeRequest } from "@/lib/auth/session";
import { buildTemplateWorkbook } from "@/lib/import/price-list-template";

// GET /api/imports/template: the blank price-list template (.xlsx). Any signed-in staff member may download it.
export async function GET() {
  const auth = await authorizeRequest();
  if (auth.response) return auth.response;
  const bytes = await buildTemplateWorkbook();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="price-list-template.xlsx"',
      "Cache-Control": "private, no-cache",
    },
  });
}
