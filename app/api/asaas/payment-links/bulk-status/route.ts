import { asaasRequest } from "@/lib/asaas";
import { supabaseRequest } from "@/lib/supabase-server";

type BulkPayload = { planId?: string; actorId?: string; status?: "ACTIVE" | "INACTIVE" };

/**
 * Bulk ACTIVE/INACTIVE toggle for every payment link bound to a plan
 * (e.g. a discontinued/legacy plan — old customers keep paying through
 * their existing subscription, but nobody should be able to open the link
 * and start a brand new one) or to a commercial actor (e.g. a partner who
 * left the program). Mirrors each link onto Asaas individually, same as
 * the single-link toggle in `app/api/asaas/payment-links` — this is just
 * that same operation looped over every matching link.
 */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as BulkPayload;
    if (!payload.planId && !payload.actorId) return Response.json({ error: "Informe um plano ou um parceiro/embaixador." }, { status: 400 });
    const status = payload.status === "ACTIVE" ? "ACTIVE" : "INACTIVE";

    const filters = ["status=neq." + status];
    if (payload.planId) filters.push(`plan_id=eq.${encodeURIComponent(payload.planId)}`);
    if (payload.actorId) filters.push(`actor_id=eq.${encodeURIComponent(payload.actorId)}`);
    const links = await supabaseRequest<{ id: string; display_name: string; asaas_payment_link_id: string | null }[]>(
      `/rest/v1/payment_links?select=id,display_name,asaas_payment_link_id&${filters.join("&")}`,
    );

    let succeeded = 0;
    const failed: string[] = [];
    for (const link of links) {
      try {
        if (link.asaas_payment_link_id) {
          await asaasRequest(`/paymentLinks/${encodeURIComponent(link.asaas_payment_link_id)}`, { method: "PUT", body: { active: status === "ACTIVE" } });
        }
        await supabaseRequest(`/rest/v1/payment_links?id=eq.${encodeURIComponent(link.id)}`, { method: "PATCH", body: { status } });
        succeeded += 1;
      } catch {
        failed.push(link.display_name);
      }
    }

    if (links.length > 0) {
      await supabaseRequest("/rest/v1/audit_events", {
        method: "POST",
        body: { entity_type: "payment_link", entity_id: payload.planId ?? payload.actorId ?? "", action: "BULK_STATUS_CHANGE", after_json: { planId: payload.planId ?? null, actorId: payload.actorId ?? null, status, total: links.length, succeeded, failed } },
      }).catch(() => null);
    }

    return Response.json({ total: links.length, succeeded, failed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar os links em lote." }, { status: 500 });
  }
}
