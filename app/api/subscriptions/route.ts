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

/**
 * Manually registers a plan/subscription for a customer that isn't (or
 * isn't yet) backed by a real Asaas payment — e.g. someone who came in
 * through the "⭐ Base de Clientes" sheet intake and is billed outside this
 * system. Marked source: 'MANUAL' so reports can tell it apart from
 * payment-verified ('SYSTEM') and bulk-imported ('LEGACY_IMPORT') rows.
 */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      customerId?: string;
      planName?: string;
      billingPeriod?: "MONTHLY" | "ANNUAL";
      value?: number;
      paymentMethod?: string | null;
      startedAt?: string | null;
      status?: "ACTIVE" | "CANCELLED" | "FROZEN";
    };
    if (!payload.customerId) return Response.json({ error: "Informe o cliente." }, { status: 400 });
    if (!payload.planName?.trim()) return Response.json({ error: "Informe o nome do plano." }, { status: 400 });
    if (payload.billingPeriod !== "MONTHLY" && payload.billingPeriod !== "ANNUAL") return Response.json({ error: "Periodicidade inválida." }, { status: 400 });
    const value = Number(payload.value);
    if (!Number.isFinite(value) || value <= 0) return Response.json({ error: "Informe um valor válido." }, { status: 400 });

    const [created] = await supabaseRequest<Subscription[]>("/rest/v1/subscriptions", {
      method: "POST",
      prefer: "return=representation",
      body: {
        customer_id: payload.customerId,
        plan_name_raw: payload.planName.trim(),
        billing_period: payload.billingPeriod,
        value,
        payment_method: payload.paymentMethod || null,
        status: payload.status ?? "ACTIVE",
        started_at: payload.startedAt || new Date().toISOString().slice(0, 10),
        source: "MANUAL",
      },
    });
    return Response.json({ subscription: created }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao cadastrar assinatura." }, { status: 500 });
  }
}
