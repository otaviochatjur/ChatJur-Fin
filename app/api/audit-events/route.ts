import { supabaseRequest } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const limit = new URL(request.url).searchParams.get("limit") ?? "20";
    const events = await supabaseRequest<unknown[]>(
      `/rest/v1/audit_events?select=*&order=created_at.desc&limit=${encodeURIComponent(limit)}`,
    );
    return Response.json({ events });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar auditoria." }, { status: 500 });
  }
}
