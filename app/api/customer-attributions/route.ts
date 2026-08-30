import { supabaseRequest } from "@/lib/supabase-server";

export async function GET() {
  try {
    const attributions = await supabaseRequest<unknown[]>(
      "/rest/v1/customer_attributions?select=*&order=attributed_at.desc",
    );
    return Response.json({ attributions });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar clientes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { customerExternalId?: string; partnerActorId?: string; externalSalesActorId?: string; paymentLinkId?: string; notes?: string };
    const customerExternalId = payload.customerExternalId?.trim();
    if (!customerExternalId || (!payload.partnerActorId && !payload.externalSalesActorId)) {
      return Response.json({ error: "Identificação do cliente e ao menos um responsável (parceiro ou comercial) são obrigatórios." }, { status: 400 });
    }
    const [attribution] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/customer_attributions", {
      method: "POST",
      prefer: "return=representation",
      body: {
        customer_external_id: customerExternalId,
        partner_actor_id: payload.partnerActorId || null,
        external_sales_actor_id: payload.externalSalesActorId || null,
        payment_link_id: payload.paymentLinkId || null,
        notes: payload.notes?.trim() || null,
      },
    });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "customer_attribution", entity_id: String(attribution.id), action: "CREATED", after_json: attribution } });
    return Response.json({ attribution }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atribuir cliente." }, { status: 500 });
  }
}
