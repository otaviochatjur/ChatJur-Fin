import { presentSubscription, type SubscriptionWithRelations } from "@/lib/subscription-presentation";
import { readCustomerActivities } from "@/lib/customer-activity-server";
import { effectiveSubscriptions } from "@/lib/customer-activity";
import type { Subscription } from "@/lib/metrics";
import { supabaseRequest } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const filters = [
      "select=*,plans(name),actor_custom_plans(name),commercial_actors(id,name,role,tier),payment_links(plans(name),actor_custom_plans(name),commercial_actors(id,name,role,tier))",
      params.get("actorId") ? `actor_id=eq.${encodeURIComponent(params.get("actorId")!)}` : null,
      params.get("customerId") ? `customer_id=eq.${encodeURIComponent(params.get("customerId")!)}` : null,
      params.get("paymentLinkId") ? `payment_link_id=eq.${encodeURIComponent(params.get("paymentLinkId")!)}` : null,
      "order=created_at.desc",
    ].filter(Boolean).join("&");
    const subscriptions = await supabaseRequest<SubscriptionWithRelations[]>(`/rest/v1/subscriptions?${filters}`);
    return Response.json({ subscriptions: effectiveSubscriptions(subscriptions, await readCustomerActivities()).map(presentSubscription) });
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

/**
 * Lets the operator manually confirm a subscription's status — mainly for
 * the ones that came out of the Set/2026 reset with `status: null` (see
 * `lib/metrics.ts`). Automated sync (`lib/payment-sync.ts`) still sets
 * ACTIVE on its own whenever a real paid payment lands; this is only for
 * the operator-driven cases (FROZEN, CANCELLED, or confirming ACTIVE by hand).
 */
export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as { id?: string; status?: "ACTIVE" | "FROZEN" | "CANCELLED" };
    if (!payload.id) return Response.json({ error: "Informe a assinatura." }, { status: 400 });
    if (payload.status !== "ACTIVE" && payload.status !== "FROZEN" && payload.status !== "CANCELLED") return Response.json({ error: "Status inválido." }, { status: 400 });
    const body: Record<string, unknown> = { status: payload.status, status_manually_set: true, cancelled_at: payload.status === "CANCELLED" ? new Date().toISOString().slice(0, 10) : null };
    const [updated] = await supabaseRequest<Subscription[]>(`/rest/v1/subscriptions?id=eq.${payload.id}`, { method: "PATCH", prefer: "return=representation", body });
    if (!updated) return Response.json({ error: "Assinatura não encontrada." }, { status: 404 });
    return Response.json({ subscription: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar assinatura." }, { status: 500 });
  }
}
