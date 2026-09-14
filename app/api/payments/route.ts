import { supabaseRequest } from "@/lib/supabase-server";
import { payoutPeriodWindow } from "@/lib/payout-period";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const payoutPeriod = params.get("payoutPeriod");
    if (payoutPeriod) {
      let window;
      try { window = payoutPeriodWindow(payoutPeriod); }
      catch { return Response.json({ error: "Período inválido." }, { status: 400 }); }
      const select = "select=id,subscription_id,payment_link_id,asaas_payment_id,asaas_payment_link_id,customer_id,status,value,net_value,billing_type,due_date,payment_date,confirmed_date,refunded_at,created_at";
      const [paidOnDate, confirmedWithoutPaymentDate] = await Promise.all([
        supabaseRequest<unknown[]>(`/rest/v1/payments?${select}&payment_date=gte.${window.start}&payment_date=lt.${window.endExclusive}&order=payment_date.desc&limit=5000`),
        supabaseRequest<unknown[]>(`/rest/v1/payments?${select}&payment_date=is.null&confirmed_date=gte.${window.start}&confirmed_date=lt.${window.endExclusive}&order=confirmed_date.desc&limit=5000`),
      ]);
      return Response.json({ payments: [...paidOnDate, ...confirmedWithoutPaymentDate], window });
    }
    const period = params.get("period");
    if (period && !/^\d{4}-\d{2}$/.test(period)) return Response.json({ error: "Período inválido." }, { status: 400 });
    if (period) {
      const [year, month] = period.split("-").map(Number);
      const start = `${period}-01`;
      const endDate = new Date(Date.UTC(year, month, 1));
      const end = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
      const select = "select=id,subscription_id,payment_link_id,asaas_payment_id,asaas_payment_link_id,customer_id,status,value,net_value,billing_type,due_date,payment_date,confirmed_date,refunded_at,created_at";
      const [paidOnDate, confirmedWithoutPaymentDate] = await Promise.all([
        supabaseRequest<unknown[]>(`/rest/v1/payments?${select}&payment_date=gte.${start}&payment_date=lt.${end}&order=payment_date.desc&limit=5000`),
        supabaseRequest<unknown[]>(`/rest/v1/payments?${select}&payment_date=is.null&confirmed_date=gte.${start}&confirmed_date=lt.${end}&order=confirmed_date.desc&limit=5000`),
      ]);
      return Response.json({ payments: [...paidOnDate, ...confirmedWithoutPaymentDate] });
    }
    const filters = [
      "select=id,subscription_id,payment_link_id,asaas_payment_id,asaas_payment_link_id,customer_id,status,value,net_value,billing_type,due_date,payment_date,confirmed_date,refunded_at,created_at",
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
