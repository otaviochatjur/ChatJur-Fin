import { readCustomerActivities } from "@/lib/customer-activity-server";
import { effectiveSubscriptions } from "@/lib/customer-activity";
import type { Subscription } from "@/lib/metrics";
import { supabaseRequest } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const filters = [
      "select=*",
      params.get("actorId") ? `actor_id=eq.${encodeURIComponent(params.get("actorId")!)}` : null,
      params.get("customerId") ? `customer_id=eq.${encodeURIComponent(params.get("customerId")!)}` : null,
      params.get("paymentLinkId") ? `payment_link_id=eq.${encodeURIComponent(params.get("paymentLinkId")!)}` : null,
      "order=created_at.desc",
    ].filter(Boolean).join("&");
    const subscriptions = await supabaseRequest<Subscription[]>(`/rest/v1/subscriptions?${filters}`);
    return Response.json({ subscriptions: effectiveSubscriptions(subscriptions, await readCustomerActivities()) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar assinaturas." }, { status: 500 });
  }
}
