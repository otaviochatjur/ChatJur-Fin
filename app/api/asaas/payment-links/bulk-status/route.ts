import { supabaseRequest } from "@/lib/supabase-server";

type BulkPayload = { planId?: string; actorId?: string; status?: "ACTIVE" | "INACTIVE" };

/**
 * Archives/unarchives every payment link bound to a plan or commercial
 * actor. This is local organization only; changing availability at Asaas is
 * deliberately restricted to an individual link that is already archived.
 */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as BulkPayload;
    if (!payload.planId && !payload.actorId) return Response.json({ error: "Informe um plano ou um parceiro/embaixador." }, { status: 400 });
    const status = payload.status === "ACTIVE" ? "ACTIVE" : "INACTIVE";

    const filters = ["status=neq." + status];
    if (payload.planId) filters.push(`plan_id=eq.${encodeURIComponent(payload.planId)}`);
    if (payload.actorId) filters.push(`actor_id=eq.${encodeURIComponent(payload.actorId)}`);
    const links = await supabaseRequest<{ id: string; display_name: string }[]>(
      `/rest/v1/payment_links?select=id,display_name&${filters.join("&")}`,
    );

    let succeeded = 0;
    const failed: string[] = [];
    for (const link of links) {
      try {
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
