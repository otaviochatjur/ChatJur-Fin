import { supabaseRequest } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const limit = params.get("limit") ?? "20";
    const entityType = params.get("entityType");
    const filters = [
      "select=*",
      entityType ? `entity_type=eq.${encodeURIComponent(entityType)}` : null,
      "order=created_at.desc",
      `limit=${encodeURIComponent(limit)}`,
    ].filter(Boolean).join("&");
    const events = await supabaseRequest<unknown[]>(`/rest/v1/audit_events?${filters}`);
    return Response.json({ events });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar auditoria." }, { status: 500 });
  }
}
