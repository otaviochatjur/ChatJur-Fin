import { supabaseRequest } from "@/lib/supabase-server";

/**
 * Ledger of repasses actually paid (`actor_payouts`). Pending amounts for a
 * period are never stored here — they're computed live on the client from
 * subscriptions/payments/commission-rates (see `computeActorPayout` in
 * `lib/metrics.ts`) so they can't go stale. A row only exists once a month
 * has been explicitly marked as paid.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const actorId = params.get("actorId");
    const filters = ["select=*", actorId ? `actor_id=eq.${encodeURIComponent(actorId)}` : null, "order=reference_month.desc"].filter(Boolean).join("&");
    const payouts = await supabaseRequest<unknown[]>(`/rest/v1/actor_payouts?${filters}`);
    return Response.json({ payouts });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar repasses." }, { status: 500 });
  }
}

/** Marks a period as paid for an actor (upsert — editing an already-paid month overwrites it). */
export async function POST(request: Request) {
  try {
    const payload = await request.json() as { actorId?: string; period?: string; amount?: number; computedAmount?: number; notes?: string };
    const amount = Number(payload.amount);
    if (!payload.actorId || !payload.period || !/^\d{4}-\d{2}$/.test(payload.period) || !Number.isFinite(amount) || amount < 0) {
      return Response.json({ error: "Parceiro, período (AAAA-MM) e valor válido são obrigatórios." }, { status: 400 });
    }
    const referenceMonth = `${payload.period}-01`;
    const body = {
      actor_id: payload.actorId,
      reference_month: referenceMonth,
      amount,
      computed_amount: Number.isFinite(Number(payload.computedAmount)) ? Number(payload.computedAmount) : amount,
      notes: payload.notes?.trim() || null,
      paid_at: new Date().toISOString(),
    };

    const existing = await supabaseRequest<{ id: string }[]>(`/rest/v1/actor_payouts?select=id&actor_id=eq.${encodeURIComponent(payload.actorId)}&reference_month=eq.${referenceMonth}`);
    let record: Record<string, unknown>;
    if (existing[0]) {
      [record] = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/actor_payouts?id=eq.${existing[0].id}`, { method: "PATCH", prefer: "return=representation", body });
    } else {
      [record] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/actor_payouts", { method: "POST", prefer: "return=representation", body });
    }
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "actor_payout", entity_id: String(record.id), action: "CREATED", after_json: record } });
    return Response.json({ payout: record }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao registrar repasse." }, { status: 500 });
  }
}

/** Undoes a "marked as paid" — the period goes back to pending/computed-live. */
export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id é obrigatório." }, { status: 400 });
    await supabaseRequest(`/rest/v1/actor_payouts?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao remover repasse." }, { status: 500 });
  }
}
