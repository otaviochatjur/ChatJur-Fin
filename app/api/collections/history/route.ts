import { requireUser } from "@/lib/auth-server";
import { supabaseRequest } from "@/lib/supabase-server";
import { collectionToday } from "@/lib/collection-policy";
export async function GET(request: Request) {
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    const month = new URL(request.url).searchParams.get("month") ?? collectionToday().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return Response.json({error:"Mês inválido."},{status:400});
    const end = new Date(`${month}-01T03:00:00Z`); end.setUTCMonth(end.getUTCMonth()+1);
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await supabaseRequest<unknown[]>(`/rest/v1/audit_events?entity_type=eq.collection_send&created_at=gte.${month}-01T03:00:00Z&created_at=lt.${end.toISOString()}&select=id,action,after_json,created_at&order=created_at.asc,id.asc&limit=500&offset=${offset}`);
      rows.push(...page); if (page.length < 500) break;
    }
    return Response.json({ month, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Não foi possível carregar o histórico." }, { status: 400 }); }
}
