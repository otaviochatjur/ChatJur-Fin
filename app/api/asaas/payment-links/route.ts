import { supabaseRequest } from "@/lib/supabase-server";

type PaymentLinkRequest = { partnerId?: string; partnerName?: string; planId?: string; planName?: string; billingPeriod?: "MONTHLY" | "ANNUAL"; priceVersion?: string; priceVersionId?: string; value?: number };

export async function GET(request: Request) {
  try {
    const actorId = new URL(request.url).searchParams.get("actorId");
    const filter = actorId ? `&actor_id=eq.${encodeURIComponent(actorId)}` : "";
    const links = await supabaseRequest<unknown[]>(`/rest/v1/payment_links?select=*&order=created_at.desc${filter}`);
    return Response.json({ links });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar links." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ASAAS_API_KEY;
    const baseUrl = process.env.ASAAS_BASE_URL ?? "https://api-sandbox.asaas.com/v3";
    if (!apiKey) return Response.json({ error: "A integração com o Asaas ainda não foi configurada." }, { status: 503 });

    const payload = (await request.json()) as PaymentLinkRequest;
    const value = Number(payload.value);
    if (!payload.partnerId || !payload.planName || !Number.isFinite(value) || value <= 0) return Response.json({ error: "Responsável, plano e valor válido são obrigatórios." }, { status: 400 });

    const annual = payload.billingPeriod === "ANNUAL";
    const externalReference = ["CJ", "ACTOR", payload.partnerId, payload.planId ?? "PLAN", payload.priceVersion ?? "V1"].join("_").toUpperCase();
    const asaasPayload = { name: `${payload.planName} — ${annual ? "Plano Anual" : "Plano Mensal"}`, description: `${annual ? "Licença anual" : "Assinatura mensal"} do Chat Jurídico — indicação ${payload.partnerName ?? payload.partnerId}`, value, billingType: "UNDEFINED", chargeType: annual ? "INSTALLMENT" : "RECURRENT", ...(annual ? { maxInstallmentCount: 6 } : { subscriptionCycle: "MONTHLY" }), dueDateLimitDays: 10, externalReference, notificationEnabled: true };
    const response = await fetch(`${baseUrl}/paymentLinks`, { method: "POST", headers: { "Content-Type": "application/json", access_token: apiKey }, body: JSON.stringify(asaasPayload) });
    const data = await response.json();
    if (!response.ok) return Response.json({ error: "O Asaas recusou a criação do link.", details: data }, { status: response.status });

    const [record] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/payment_links", { method: "POST", prefer: "return=representation", body: { actor_id: payload.partnerId, plan_id: payload.planId || null, price_version_id: payload.priceVersionId || null, asaas_payment_link_id: data.id ?? null, external_reference: externalReference, url: data.url ?? null, display_name: asaasPayload.name, value, billing_period: annual ? "ANNUAL" : "MONTHLY", max_installments: annual ? 6 : null, status: "ACTIVE", source: "ASAAS_API" } });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "payment_link", entity_id: String(record.id), action: "CREATED", after_json: record } });
    return Response.json({ paymentLink: data, record, externalReference }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao gerar link." }, { status: 500 });
  }
}
