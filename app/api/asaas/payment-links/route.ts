import { asaasRequest, getAsaasConfig } from "@/lib/asaas";
import { isOneTimePlanKind, isPaidStatus, type Plan } from "@/lib/metrics";
import { supabaseRequest } from "@/lib/supabase-server";

type PaymentLinkRequest = { partnerId?: string; partnerName?: string; planId?: string; customPlanId?: string; planName?: string; description?: string; billingPeriod?: "MONTHLY" | "ANNUAL"; priceVersion?: string; priceVersionId?: string; value?: number; maxInstallments?: number };

/**
 * Real per-link performance: how many customers actually subscribed through
 * it and how much they've actually paid — not the link's face value. A link
 * can sit unused forever without inflating any number here.
 */
async function attachRealStats(links: Record<string, unknown>[]) {
  const ids = links.map((link) => String(link.id));
  if (ids.length === 0) return links;
  const inFilter = `payment_link_id=in.(${ids.join(",")})`;
  const [subscriptions, payments] = await Promise.all([
    supabaseRequest<{ payment_link_id: string; status: string; customer_id: string }[]>(`/rest/v1/subscriptions?select=payment_link_id,status,customer_id&${inFilter}`),
    supabaseRequest<{ payment_link_id: string; status: string; value: number }[]>(`/rest/v1/payments?select=payment_link_id,status,value&${inFilter}`),
  ]);
  const activeSubscribers = new Map<string, Set<string>>();
  for (const sub of subscriptions) {
    if (sub.status !== "ACTIVE") continue;
    const set = activeSubscribers.get(sub.payment_link_id) ?? new Set<string>();
    set.add(sub.customer_id);
    activeSubscribers.set(sub.payment_link_id, set);
  }
  const totalReceived = new Map<string, number>();
  for (const payment of payments) {
    if (!isPaidStatus(payment.status)) continue;
    totalReceived.set(payment.payment_link_id, (totalReceived.get(payment.payment_link_id) ?? 0) + Number(payment.value));
  }
  return links.map((link) => ({
    ...link,
    active_subscribers: activeSubscribers.get(String(link.id))?.size ?? 0,
    total_received: totalReceived.get(String(link.id)) ?? 0,
  }));
}

export async function GET(request: Request) {
  try {
    const actorId = new URL(request.url).searchParams.get("actorId");
    const filter = actorId ? `&actor_id=eq.${encodeURIComponent(actorId)}` : "";
    const links = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/payment_links?select=*&order=created_at.desc${filter}`);
    // active_subscribers/total_received are only read from the per-actor
    // links tab (actor-workspace.tsx, which always passes actorId — a
    // handful of links). The *unscoped* call (root dashboard load, "Planos
    // e Links" screen: up to hundreds of links) used to pay for this too —
    // attachRealStats scans practically the whole subscriptions/payments
    // tables via `payment_link_id=in.(...ids)` — for numbers nobody reads
    // there, adding real, measured latency (~800ms) to every full reload.
    const withStats = actorId ? await attachRealStats(links) : links;
    return Response.json({ links: withStats });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar links." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const config = await getAsaasConfig();
    if (!config) return Response.json({ error: "A integração com o Asaas ainda não foi configurada." }, { status: 503 });

    const payload = (await request.json()) as PaymentLinkRequest;
    const value = Number(payload.value);
    if (!payload.partnerId || !payload.planName || !Number.isFinite(value) || value <= 0) return Response.json({ error: "Responsável, plano e valor válido são obrigatórios." }, { status: 400 });

    const annual = payload.billingPeriod === "ANNUAL";
    const maxInstallments = annual ? Math.min(12, Math.max(1, Math.round(Number(payload.maxInstallments) || 6))) : null;
    const externalReference = ["CJ", "ACTOR", payload.partnerId, payload.planId ?? payload.customPlanId ?? "PLAN", payload.priceVersion ?? "V1", Date.now().toString(36)].join("_").toUpperCase();
    // Every generated link's name carries the referring partner/embaixador/comercial
    // externo's full name, so it's identifiable at a glance in the Asaas dashboard
    // and in our own "Links gerados" list.
    const referrerName = (payload.partnerName ?? "").trim();
    const linkName = `${payload.planName} — ${annual ? "Plano Anual" : "Plano Mensal"}${referrerName ? ` · ${referrerName}` : ""}`;
    const description = payload.description?.trim() || `${annual ? "Licença anual" : "Assinatura mensal"} do Chat Jurídico — indicação ${payload.partnerName ?? payload.partnerId}`;
    const asaasPayload = { name: linkName, description, value, billingType: "UNDEFINED", chargeType: annual ? "INSTALLMENT" : "RECURRENT", ...(annual ? { maxInstallmentCount: maxInstallments } : { subscriptionCycle: "MONTHLY" }), dueDateLimitDays: 1, externalReference, notificationEnabled: true };
    const response = await fetch(`${config.baseUrl}/paymentLinks`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "ChatJuridicoFinanceiro/1.0", access_token: config.apiKey }, body: JSON.stringify(asaasPayload) });
    const data = await response.json();
    if (!response.ok) {
      const asaasReason = Array.isArray(data?.errors) && data.errors.length > 0
        ? data.errors.map((item: { description?: string }) => item.description).filter(Boolean).join(" ")
        : null;
      return Response.json({ error: asaasReason ?? "O Asaas recusou a criação do link.", details: data }, { status: response.status });
    }

    const [record] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/payment_links", { method: "POST", prefer: "return=representation", body: { actor_id: payload.partnerId, plan_id: payload.planId || null, custom_plan_id: payload.customPlanId || null, price_version_id: payload.priceVersionId || null, asaas_payment_link_id: data.id ?? null, external_reference: externalReference, url: data.url ?? null, display_name: asaasPayload.name, value, billing_period: annual ? "ANNUAL" : "MONTHLY", max_installments: maxInstallments, status: "ACTIVE", source: "ASAAS_API", asaas_snapshot: data, asaas_synced_at: new Date().toISOString() } });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "payment_link", entity_id: String(record.id), action: "CREATED", after_json: record } });
    return Response.json({ paymentLink: data, record, externalReference }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao gerar link." }, { status: 500 });
  }
}

type BindPayload = { id?: string; actorId?: string | null; planId?: string | null; status?: "ACTIVE" | "INACTIVE" | "PENDING" };

/**
 * Binds (or rebinds) a payment link to a partner/ambassador/sales rep and/or
 * a plan, and/or manually toggles it ACTIVE/INACTIVE. Used by the links
 * management panel, mainly to resolve links that came from `sync-links` as
 * orphans (created directly in the Asaas dashboard, so nobody here knows
 * who they belong to or which plan they represent yet) — and to let an
 * operator deactivate a link straight from here.
 */
export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as BindPayload;
    if (!payload.id) return Response.json({ error: "id é obrigatório." }, { status: 400 });

    const [current] = await supabaseRequest<{ actor_id: string | null; plan_id: string | null; status: string; asaas_payment_link_id: string | null }[]>(
      `/rest/v1/payment_links?id=eq.${encodeURIComponent(payload.id)}&select=actor_id,plan_id,status,asaas_payment_link_id`,
    );
    if (!current) return Response.json({ error: "Link não encontrado." }, { status: 404 });

    const body: Record<string, unknown> = {};
    if (payload.actorId !== undefined) body.actor_id = payload.actorId || null;
    if (payload.planId !== undefined) {
      body.plan_id = payload.planId || null;
      // Vinculando a um plano de Implantação ou Consultoria: o link passa a
      // representar uma taxa única, não mais um plano recorrente — cascateia
      // billing_period para ONE_TIME, o mesmo sinal que lib/payment-sync.ts
      // usa para rotear o pagamento para implementation_payments em vez de
      // subscriptions.
      if (payload.planId) {
        const [plan] = await supabaseRequest<{ kind: Plan["kind"] }[]>(`/rest/v1/plans?id=eq.${encodeURIComponent(payload.planId)}&select=kind`);
        if (isOneTimePlanKind(plan?.kind)) body.billing_period = "ONE_TIME";
      }
    }

    const nextPlanId = payload.planId !== undefined ? payload.planId : current.plan_id;
    // A manual ACTIVE/INACTIVE toggle (the "Desativar"/"Reativar" button)
    // always wins over the automatic PENDING/ACTIVE bookkeeping below, and —
    // unlike that bookkeeping, which is purely local — mirrors onto the real
    // link at Asaas so the payer actually can't pay it anymore either.
    //
    // Only the plan gates "pending": the actor is deliberately optional —
    // plenty of links are direct company sales with no partner/embaixador/
    // comercial behind them, and those are fully resolved once the plan is
    // known, with no owner to assign. Requiring both used to leave
    // plan-only-bound direct-sale links stuck as "pendente" forever.
    if (payload.status !== undefined) {
      body.status = payload.status;
      if ((payload.status === "ACTIVE" || payload.status === "INACTIVE") && current.asaas_payment_link_id) {
        await asaasRequest(`/paymentLinks/${encodeURIComponent(current.asaas_payment_link_id)}`, {
          method: "PUT",
          body: { active: payload.status === "ACTIVE" },
        });
      }
    } else if (current.status === "PENDING" && nextPlanId) {
      body.status = "ACTIVE";
    } else if (current.status !== "INACTIVE" && !nextPlanId) {
      body.status = "PENDING";
    }
    if (Object.keys(body).length === 0) return Response.json({ error: "Nada para atualizar." }, { status: 400 });

    const [record] = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/payment_links?id=eq.${encodeURIComponent(payload.id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body,
    });

    // Retroativo: clientes que já pagaram por este link antes dele ter
    // (ou ter mudado de) plano vinculado ficaram com plan_id nulo/errado nas
    // suas assinaturas — lib/payment-sync.ts só grava plan_id na CRIAÇÃO da
    // assinatura, nunca ao atualizar uma existente, então sem isso o vínculo
    // do link com o plano nunca "voltaria no tempo" para quem já pagou. Isso
    // importa de verdade: o cálculo de repasse por plano (findCommissionRate)
    // e a quebra de receita por plano (Receita e MRR) dependem de
    // subscriptions.plan_id, não do nome do link — daí o backfill imediato.
    let backfilled: { subscriptions: number; implementationPayments: number } | null = null;
    if (body.plan_id !== undefined) {
      const [subs, impl] = await Promise.all([
        supabaseRequest<unknown[]>(`/rest/v1/subscriptions?payment_link_id=eq.${encodeURIComponent(payload.id)}`, { method: "PATCH", prefer: "return=representation", body: { plan_id: body.plan_id } }).catch(() => []),
        supabaseRequest<unknown[]>(`/rest/v1/implementation_payments?payment_link_id=eq.${encodeURIComponent(payload.id)}`, { method: "PATCH", prefer: "return=representation", body: { plan_id: body.plan_id } }).catch(() => []),
      ]);
      backfilled = { subscriptions: subs.length, implementationPayments: impl.length };
    }

    return Response.json({ record, backfilled });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao vincular link." }, { status: 500 });
  }
}
