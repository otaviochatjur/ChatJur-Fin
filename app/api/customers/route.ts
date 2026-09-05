import { supabaseRequest } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const filters = [
      "select=*",
      params.get("status") ? `status=eq.${encodeURIComponent(params.get("status")!)}` : null,
      params.get("actorId") ? `acquisition_actor_id=eq.${encodeURIComponent(params.get("actorId")!)}` : null,
      "order=created_at.desc",
    ].filter(Boolean).join("&");
    const customers = await supabaseRequest<unknown[]>(`/rest/v1/customers?${filters}`);
    return Response.json({ customers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar clientes." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as {
      id?: string;
      status?: "ACTIVE" | "CANCELLED" | "FROZEN";
      officeName?: string;
      responsibleName?: string;
      email?: string;
      phone?: string;
      city?: string;
      state?: string;
      cancellationCategory?: string;
      cancellationReason?: string;
      comments?: string;
      acquisitionActorId?: string | null;
    };
    if (!payload.id) return Response.json({ error: "id é obrigatório." }, { status: 400 });

    const body: Record<string, unknown> = {};
    if (payload.status !== undefined) {
      body.status = payload.status;
      if (payload.status === "CANCELLED") body.cancelled_at = new Date().toISOString().slice(0, 10);
    }
    if (payload.officeName !== undefined) body.office_name = payload.officeName;
    if (payload.responsibleName !== undefined) body.responsible_name = payload.responsibleName;
    if (payload.email !== undefined) body.email = payload.email;
    if (payload.phone !== undefined) body.phone = payload.phone;
    if (payload.city !== undefined) body.city = payload.city;
    if (payload.state !== undefined) body.state = payload.state;
    if (payload.cancellationCategory !== undefined) body.cancellation_category = payload.cancellationCategory;
    if (payload.cancellationReason !== undefined) body.cancellation_reason = payload.cancellationReason;
    if (payload.comments !== undefined) body.comments = payload.comments;
    if (payload.acquisitionActorId !== undefined) body.acquisition_actor_id = payload.acquisitionActorId;

    if (Object.keys(body).length === 0) return Response.json({ error: "Nada para atualizar." }, { status: 400 });

    const [customer] = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/customers?id=eq.${encodeURIComponent(payload.id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body,
    });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "customer", entity_id: payload.id, action: "UPDATED", after_json: customer } });
    return Response.json({ customer });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar cliente." }, { status: 500 });
  }
}
