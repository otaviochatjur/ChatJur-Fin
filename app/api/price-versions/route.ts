import { supabaseRequest } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const actorId = new URL(request.url).searchParams.get("actorId");
    if (!actorId) return Response.json({ error: "actorId é obrigatório." }, { status: 400 });
    const rows = await supabaseRequest<unknown[]>(`/rest/v1/actor_price_versions?select=*&actor_id=eq.${encodeURIComponent(actorId)}&order=effective_from.desc`);
    return Response.json({ priceVersions: rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar preços." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { actorId?: string; planId?: string; value?: number; effectiveFrom?: string; applyToRenewals?: boolean; changeReason?: string; actorEmail?: string };
    const value = Number(payload.value);
    if (!payload.actorId || !payload.planId || !Number.isFinite(value) || value <= 0 || !payload.effectiveFrom) return Response.json({ error: "Parceiro, plano, valor e vigência são obrigatórios." }, { status: 400 });
    const version = await supabaseRequest<Record<string, unknown>>("/rest/v1/rpc/create_actor_price_version", { method: "POST", body: { p_actor_id: payload.actorId, p_plan_id: payload.planId, p_value: value, p_effective_from: payload.effectiveFrom, p_apply_to_renewals: Boolean(payload.applyToRenewals), p_change_reason: payload.changeReason?.trim() || null, p_actor_email: payload.actorEmail ?? null } });
    return Response.json({ priceVersion: version }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao salvar preço." }, { status: 500 });
  }
}
