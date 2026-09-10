import { supabaseRequest } from "@/lib/supabase-server";

type BulkPayload = { planId?: string; actorId?: string; ids?: string[]; status?: "ACTIVE" | "INACTIVE" };
const validId = (value: string) => /^[a-f0-9-]{36}$/i.test(value);

/**
 * Archives/unarchives payment links selected explicitly or grouped by a
 * plan/commercial actor. This is local organization only; changing
 * availability at Asaas is deliberately restricted to an individual link
 * that is already archived.
 */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as BulkPayload;
    const ids = [...new Set(Array.isArray(payload.ids) ? payload.ids : [])];
    if (ids.length > 500 || ids.some((id) => !validId(id))) return Response.json({ error: "Seleção de links inválida." }, { status: 400 });
    if (!payload.planId && !payload.actorId && ids.length === 0) return Response.json({ error: "Selecione ao menos um link." }, { status: 400 });
    const status = payload.status === "ACTIVE" ? "ACTIVE" : "INACTIVE";

    const filters = ["status=neq." + status];
    if (payload.planId) filters.push(`plan_id=eq.${encodeURIComponent(payload.planId)}`);
    if (payload.actorId) filters.push(`actor_id=eq.${encodeURIComponent(payload.actorId)}`);
    if (ids.length > 0) filters.push(`id=in.(${ids.join(",")})`);
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
        body: { entity_type: "payment_link", entity_id: payload.planId ?? payload.actorId ?? "selected-links", action: "BULK_STATUS_CHANGE", after_json: { planId: payload.planId ?? null, actorId: payload.actorId ?? null, ids, status, total: links.length, succeeded, failed } },
      }).catch(() => null);
    }

    return Response.json({ total: links.length, succeeded, failed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar os links em lote." }, { status: 500 });
  }
}
