import { supabaseRequest } from "@/lib/supabase-server";

function clampInstallments(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(12, Math.max(1, Math.round(num)));
}

export async function GET(request: Request) {
  try {
    const actorId = new URL(request.url).searchParams.get("actorId");
    if (!actorId) return Response.json({ error: "actorId é obrigatório." }, { status: 400 });
    const customPlans = await supabaseRequest<unknown[]>(
      `/rest/v1/actor_custom_plans?select=*&actor_id=eq.${encodeURIComponent(actorId)}&status=eq.ACTIVE&order=created_at.asc`,
    );
    return Response.json({ customPlans });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar planos personalizados." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { actorId?: string; name?: string; billingPeriod?: "MONTHLY" | "ANNUAL"; value?: number; maxInstallments?: number };
    const name = payload.name?.trim();
    const value = Number(payload.value);
    if (!payload.actorId || !name || !payload.billingPeriod || !Number.isFinite(value) || value <= 0) {
      return Response.json({ error: "Responsável, nome, periodicidade e valor válido são obrigatórios." }, { status: 400 });
    }
    const maxInstallments = payload.billingPeriod === "ANNUAL" ? clampInstallments(payload.maxInstallments) ?? 6 : null;
    const [customPlan] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/actor_custom_plans", {
      method: "POST",
      prefer: "return=representation",
      body: { actor_id: payload.actorId, name, billing_period: payload.billingPeriod, value, max_installments: maxInstallments },
    });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "actor_custom_plan", entity_id: String(customPlan.id), action: "CREATED", after_json: customPlan } });
    return Response.json({ customPlan }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao cadastrar plano personalizado." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { id?: string; value?: number; maxInstallments?: number };
    if (!payload.id) return Response.json({ error: "id é obrigatório." }, { status: 400 });
    const body: Record<string, unknown> = {};
    if (payload.value !== undefined) {
      const value = Number(payload.value);
      if (!Number.isFinite(value) || value <= 0) return Response.json({ error: "Valor inválido." }, { status: 400 });
      body.value = value;
    }
    if (payload.maxInstallments !== undefined) body.max_installments = clampInstallments(payload.maxInstallments);
    const [customPlan] = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/actor_custom_plans?id=eq.${encodeURIComponent(payload.id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body,
    });
    return Response.json({ customPlan });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar plano personalizado." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id é obrigatório." }, { status: 400 });
    await supabaseRequest(`/rest/v1/actor_custom_plans?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: { status: "INACTIVE" } });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao remover plano personalizado." }, { status: 500 });
  }
}
