import { supabaseRequest } from "@/lib/supabase-server";
import { computeActorMetrics, monthlyValue, type CommercialActor, type CustomerAttribution, type PaymentLink } from "@/lib/metrics";

export async function GET() {
  try {
    const [actors, links, attributions] = await Promise.all([
      supabaseRequest<CommercialActor[]>("/rest/v1/commercial_actors?select=*&order=role.asc,name.asc"),
      supabaseRequest<PaymentLink[]>("/rest/v1/payment_links?select=id,actor_id,value,billing_period,status"),
      supabaseRequest<CustomerAttribution[]>("/rest/v1/customer_attributions?select=id,customer_external_id,partner_actor_id,external_sales_actor_id,payment_link_id"),
    ]);

    const metrics = computeActorMetrics(actors, links, attributions);
    const totalActiveLinks = links.filter((link) => link.status === "ACTIVE").length;
    const totalMrr = links.filter((link) => link.status === "ACTIVE").reduce((sum, link) => sum + monthlyValue(link.value, link.billing_period), 0);
    const totalClients = new Set(attributions.map((attribution) => attribution.customer_external_id)).size;

    return Response.json({ actors, metrics, totals: { activeLinks: totalActiveLinks, mrr: totalMrr, clients: totalClients } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar o resumo." }, { status: 500 });
  }
}
