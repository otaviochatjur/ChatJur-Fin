import { supabaseRequest } from "@/lib/supabase-server";

const roles = ["PARTNER", "AMBASSADOR", "EXTERNAL_SALES"] as const;

export async function GET(request: Request) {
  try {
    const role = new URL(request.url).searchParams.get("role");
    const filter = role && roles.includes(role as typeof roles[number]) ? `&role=eq.${encodeURIComponent(role)}` : "";
    const actors = await supabaseRequest<unknown[]>(`/rest/v1/commercial_actors?select=*&order=role.asc,name.asc${filter}`);
    return Response.json({ actors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar cadastros." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { name?: string; role?: typeof roles[number]; email?: string; phone?: string; notes?: string };
    const name = payload.name?.trim();
    if (!name || !payload.role || !roles.includes(payload.role)) return Response.json({ error: "Nome e papel comercial válidos são obrigatórios." }, { status: 400 });
    const [actor] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/commercial_actors", { method: "POST", prefer: "return=representation", body: { name, role: payload.role, email: payload.email?.trim() || null, phone: payload.phone?.trim() || null, notes: payload.notes?.trim() || null } });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "commercial_actor", entity_id: String(actor.id), action: "CREATED", after_json: actor } });
    return Response.json({ actor }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao cadastrar." }, { status: 500 });
  }
}
