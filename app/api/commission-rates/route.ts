import { supabaseRequest } from "@/lib/supabase-server";

/**
 * Per-actor, per-plan repasse rates (see `actor_commission_rates`). A row
 * with `planId`/`customPlanId` both omitted is the actor's default/fallback
 * rate. GET without `actorId` returns every actor's rates at once — used by
 * the Repasses tab to compute all payouts for a period in one round trip.
 */
export async function GET(request: Request) {
  try {
    const actorId = new URL(request.url).searchParams.get("actorId");
    const filter = actorId ? `&actor_id=eq.${encodeURIComponent(actorId)}` : "";
    const rates = await supabaseRequest<unknown[]>(`/rest/v1/actor_commission_rates?select=*&order=actor_id.asc${filter}`);
    return Response.json({ rates });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar comissões." }, { status: 500 });
  }
}

/** Upserts a rate for (actorId, planId | customPlanId | default). */
export async function POST(request: Request) {
  try {
    const payload = await request.json() as { actorId?: string; planId?: string | null; customPlanId?: string | null; ratePercent?: number };
    const rate = Number(payload.ratePercent);
    if (!payload.actorId || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      return Response.json({ error: "Ator e taxa válida (0–100) são obrigatórios." }, { status: 400 });
    }
    if (payload.planId && payload.customPlanId) {
      return Response.json({ error: "Selecione um plano do catálogo OU um plano personalizado, não os dois." }, { status: 400 });
    }

    const scopeFilter = payload.planId
      ? `&plan_id=eq.${encodeURIComponent(payload.planId)}`
      : payload.customPlanId
        ? `&custom_plan_id=eq.${encodeURIComponent(payload.customPlanId)}`
        : "&plan_id=is.null&custom_plan_id=is.null";
    const existing = await supabaseRequest<{ id: string }[]>(`/rest/v1/actor_commission_rates?select=id&actor_id=eq.${encodeURIComponent(payload.actorId)}${scopeFilter}`);

    let record: Record<string, unknown>;
    if (existing[0]) {
      [record] = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/actor_commission_rates?id=eq.${existing[0].id}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { rate_percent: rate },
      });
    } else {
      [record] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/actor_commission_rates", {
        method: "POST",
        prefer: "return=representation",
        body: { actor_id: payload.actorId, plan_id: payload.planId || null, custom_plan_id: payload.customPlanId || null, rate_percent: rate },
      });
    }
    return Response.json({ rate: record }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao salvar comissão." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id é obrigatório." }, { status: 400 });
    await supabaseRequest(`/rest/v1/actor_commission_rates?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao remover comissão." }, { status: 500 });
  }
}
