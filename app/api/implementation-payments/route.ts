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
      "select=id,customer_id,actor_id,payment_link_id,plan_id,asaas_payment_id,description,status,value,net_value,billing_type,due_date,payment_date,confirmed_date,created_at",
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
