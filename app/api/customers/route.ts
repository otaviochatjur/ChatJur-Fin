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
      externalOfficeId?: string;
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
    if (payload.officeName !== undefined) {
      const officeName = payload.officeName.trim();
      if (!officeName) return Response.json({ error: "Informe o nome do cliente/escritório." }, { status: 400 });
      if (officeName.length > 200) return Response.json({ error: "O nome do cliente/escritório está muito longo." }, { status: 400 });
      body.office_name = officeName;
    }
    if (payload.responsibleName !== undefined) body.responsible_name = payload.responsibleName.trim() || null;
    if (payload.email !== undefined) {
      const email = payload.email.trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
      body.email = email || null;
    }
    if (payload.phone !== undefined) body.phone = payload.phone.trim() || null;
    if (payload.externalOfficeId !== undefined) {
      const externalOfficeId = payload.externalOfficeId.trim();
      if (externalOfficeId.length > 100) return Response.json({ error: "O Office ID está muito longo." }, { status: 400 });
      if (externalOfficeId) {
        const existing = await supabaseRequest<{ id: string; office_name: string }[]>(
          `/rest/v1/customers?select=id,office_name&external_office_id=eq.${encodeURIComponent(externalOfficeId)}&id=neq.${encodeURIComponent(payload.id)}&limit=1`,
        );
        if (existing[0]) return Response.json({ error: `Este Office ID já está vinculado a ${existing[0].office_name}.` }, { status: 409 });
      }
      body.external_office_id = externalOfficeId || null;
    }
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
    if (!customer) return Response.json({ error: "Cliente não encontrado." }, { status: 404 });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "customer", entity_id: payload.id, action: "UPDATED", after_json: customer } });
    return Response.json({ customer });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar cliente." }, { status: 500 });
  }
}
