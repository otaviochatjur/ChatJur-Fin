import { readCustomerActivities } from "@/lib/customer-activity-server";
import { effectiveSubscriptions } from "@/lib/customer-activity";
import { computeActorMetrics, sumImplementationRevenue, sumRealizedRevenue, type CommercialActor, type ImplementationPayment, type Payment, type PaymentLink, type Subscription } from "@/lib/metrics";
import { supabaseRequest } from "@/lib/supabase-server";

export async function GET() {
  try {
    const [actors, links, baseSubscriptions, payments, implementationPayments] = await Promise.all([
      supabaseRequest<CommercialActor[]>("/rest/v1/commercial_actors?select=*&order=role.asc,name.asc"),
      supabaseRequest<PaymentLink[]>("/rest/v1/payment_links?select=id,actor_id,value,billing_period,status"),
      supabaseRequest<Subscription[]>("/rest/v1/subscriptions?select=id,customer_id,actor_id,value,billing_period,status"),
      supabaseRequest<Payment[]>("/rest/v1/payments?select=status,value,payment_date&order=payment_date.desc.nullslast&limit=5000"),
      supabaseRequest<ImplementationPayment[]>("/rest/v1/implementation_payments?select=status,value,payment_date&order=payment_date.desc.nullslast&limit=5000"),
    ]);

    const subscriptions = effectiveSubscriptions(baseSubscriptions, await readCustomerActivities());
    const metrics = computeActorMetrics(actors, subscriptions, links);
    const totalActiveLinks = links.filter((link) => link.status === "ACTIVE").length;
    const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "ACTIVE");
    const totalMrr = activeSubscriptions.reduce((sum, subscription) => sum + (subscription.billing_period === "ANNUAL" ? subscription.value / 12 : subscription.value), 0);
    const totalClients = new Set(activeSubscriptions.map((subscription) => subscription.customer_id)).size;

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const realizedThisMonth = sumRealizedRevenue(payments.filter((payment) => (payment.payment_date ?? "").slice(0, 7) === currentMonthKey));
    const realizedTotal = sumRealizedRevenue(payments);
    const implementationThisMonth = sumImplementationRevenue(implementationPayments.filter((payment) => (payment.payment_date ?? "").slice(0, 7) === currentMonthKey));
    const implementationTotal = sumImplementationRevenue(implementationPayments);

    return Response.json({
      actors,
      metrics,
      totals: { activeLinks: totalActiveLinks, mrr: totalMrr, clients: totalClients, realizedThisMonth, realizedTotal, implementationThisMonth, implementationTotal },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar o resumo." }, { status: 500 });
  }
}
