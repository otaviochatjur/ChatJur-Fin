import { supabaseRequest } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const filters = [
      "select=id,subscription_id,payment_link_id,customer_id,asaas_payment_id,status,value,net_value,billing_type,due_date,payment_date,confirmed_date,created_at",
      params.get("customerId") ? `customer_id=eq.${encodeURIComponent(params.get("customerId")!)}` : null,
      params.get("paymentLinkId") ? `payment_link_id=eq.${encodeURIComponent(params.get("paymentLinkId")!)}` : null,
      "order=created_at.desc",
      params.get("limit") ? `limit=${encodeURIComponent(params.get("limit")!)}` : "limit=2000",
    ].filter(Boolean).join("&");
    const payments = await supabaseRequest<unknown[]>(`/rest/v1/payments?${filters}`);
    return Response.json({ payments });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar pagamentos." }, { status: 500 });
  }
}
