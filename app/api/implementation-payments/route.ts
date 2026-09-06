import { supabaseRequest } from "@/lib/supabase-server";

/**
 * Pagamentos de taxa única — implantação (API Oficial da Meta, Claude/IA,
 * etc.) ou consultoria/assessoria avulsa —, escritos por
 * `lib/payment-sync.ts` sempre que um pagamento chega para um link
 * vinculado a um plano `kind = 'IMPLEMENTATION'` ou `'CONSULTING'`. Nunca
 * aparecem em /api/payments nem em subscriptions — ledger próprio. O
 * `plan_id` de cada linha permite distinguir implantação de consultoria
 * via o `kind` do plano vinculado.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const filters = [
      "select=id,customer_id,actor_id,payment_link_id,plan_id,asaas_payment_id,source,description,status,value,net_value,billing_type,due_date,payment_date,confirmed_date,created_at",
      params.get("customerId") ? `customer_id=eq.${encodeURIComponent(params.get("customerId")!)}` : null,
      params.get("actorId") ? `actor_id=eq.${encodeURIComponent(params.get("actorId")!)}` : null,
      "order=created_at.desc",
      params.get("limit") ? `limit=${encodeURIComponent(params.get("limit")!)}` : "limit=2000",
    ].filter(Boolean).join("&");
    const payments = await supabaseRequest<unknown[]>(`/rest/v1/implementation_payments?${filters}`);
    return Response.json({ payments });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar pagamentos de implantação." }, { status: 500 });
  }
}

/**
 * Manually registers an implantação/consultoria payment that happened
 * outside the Asaas link flow — e.g. a client paid a consulting fee by bank
 * transfer, with no payment link involved at all. Marked `source: 'MANUAL'`
 * (mirrors `subscriptions.source`'s MANUAL for the analogous "cliente
 * cobrado fora do Asaas" case) and left without an `asaas_payment_id`, which
 * is optional exactly to allow this. Never touches `payments`/
 * `subscriptions`/MRR — same one-time-ledger rule as the Asaas-synced rows.
 */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      customerId?: string;
      planId?: string | null;
      actorId?: string | null;
      description?: string;
      value?: number;
      billingType?: string | null;
      paymentDate?: string | null;
    };
    if (!payload.customerId) return Response.json({ error: "Informe o cliente." }, { status: 400 });
    if (!payload.description?.trim()) return Response.json({ error: "Informe uma descrição." }, { status: 400 });
    const value = Number(payload.value);
    if (!Number.isFinite(value) || value <= 0) return Response.json({ error: "Informe um valor válido." }, { status: 400 });

    const paymentDate = payload.paymentDate || new Date().toISOString().slice(0, 10);
    const [created] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/implementation_payments", {
      method: "POST",
      prefer: "return=representation",
      body: {
        customer_id: payload.customerId,
        plan_id: payload.planId || null,
        actor_id: payload.actorId || null,
        description: payload.description.trim(),
        value,
        billing_type: payload.billingType || null,
        due_date: paymentDate,
        payment_date: paymentDate,
        confirmed_date: paymentDate,
        // RECEIVED_IN_CASH é o mesmo status que /api/payments usa para "pago
        // fora do fluxo normal" — isPaidStatus() já reconhece.
        status: "RECEIVED_IN_CASH",
        source: "MANUAL",
      },
    });
    return Response.json({ payment: created }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao cadastrar pagamento." }, { status: 500 });
  }
}
