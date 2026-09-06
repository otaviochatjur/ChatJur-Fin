/**
 * Chat Jurídico Connect categories: Parceiro/Parceiro Plus share the role
 * PARTNER (Plus is a `tier`, not a separate role — same commercial journey
 * per the Connect policy). Embaixador and Institucional are their own
 * roles. "Comercial interno/externo" (INTERNAL_SALES/EXTERNAL_SALES) are a
 * separate, unrelated grouping — plain sales staff, not part of Connect.
 */
export type CommercialActor = {
  id: string;
  name: string;
  role: "PARTNER" | "AMBASSADOR" | "EXTERNAL_SALES" | "INTERNAL_SALES" | "INSTITUTIONAL";
  /** Only meaningful for role === "PARTNER" — Parceiro (STANDARD) vs Parceiro Plus (PLUS). Promoted manually, see `CONNECT_PLUS_ELIGIBILITY_CLIENTS`. */
  tier: "STANDARD" | "PLUS";
  email: string | null;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  notes: string | null;
  /** CPF ou CNPJ. */
  document: string | null;
  pix_key: string | null;
  bank_name: string | null;
  bank_agency: string | null;
  bank_account: string | null;
  bank_account_type: "CORRENTE" | "POUPANCA" | null;
  bank_notes: string | null;
  instagram: string | null;
  linkedin: string | null;
  youtube: string | null;
  tiktok: string | null;
  twitter_x: string | null;
  website: string | null;
  created_at: string;
};

/** Roles eligible for the monthly commission payouts ("Repasses") tab — internal sales are salaried, not commissioned. */
export const PAYOUT_ELIGIBLE_ROLES = ["PARTNER", "AMBASSADOR", "EXTERNAL_SALES", "INSTITUTIONAL"] as const;

/** Number of active clients from which a Parceiro becomes eligible for the Plus tier (per the Connect policy) — surfaced as a suggestion, promotion stays manual. */
export const CONNECT_PLUS_ELIGIBILITY_CLIENTS = 5;

/** Official recurring-return % per Connect category (Chat Jurídico Connect policy, section 02) — used to seed/reset each actor's default commission rate. */
export function connectDefaultRatePercent(role: CommercialActor["role"], tier: CommercialActor["tier"]): number | null {
  switch (role) {
    case "PARTNER": return tier === "PLUS" ? 15 : 10;
    case "AMBASSADOR": return 15;
    case "INSTITUTIONAL": return 10;
    default: return null;
  }
}

export type Plan = {
  id: string;
  code: string;
  name: string;
  billing_period: "MONTHLY" | "ANNUAL" | "ONE_TIME";
  standard_value: number;
  annual_installment_limit: number | null;
  status: "ACTIVE" | "INACTIVE";
  /** RECURRING = plano de assinatura (entra no MRR). IMPLEMENTATION = taxa única de implantação (API Oficial, Claude/IA, etc.) — pagamentos vão para `implementation_payments`, nunca criam assinatura. */
  kind: "RECURRING" | "IMPLEMENTATION";
};

export const planKindLabels: Record<Plan["kind"], string> = { RECURRING: "Plano recorrente", IMPLEMENTATION: "Implantação" };

export type PriceVersion = {
  id: string;
  actor_id: string;
  plan_id: string;
  value: number;
  effective_from: string;
  effective_until: string | null;
  apply_to_renewals: boolean;
  change_reason: string | null;
  created_at: string;
};

export type PaymentLink = {
  id: string;
  /** Null for links pulled straight from Asaas that nobody has assigned to a partner/ambassador/sales rep yet. */
  actor_id: string | null;
  plan_id: string | null;
  custom_plan_id: string | null;
  price_version_id: string | null;
  asaas_payment_link_id?: string | null;
  url: string | null;
  display_name: string;
  value: number;
  billing_period: "MONTHLY" | "ANNUAL" | "ONE_TIME";
  max_installments: number | null;
  status: "ACTIVE" | "INACTIVE" | "PENDING";
  /** 'ASAAS_API' = created here via "Gerar link"; 'ASAAS_SYNC' = imported from the Asaas account, created outside this app. */
  source?: string;
  created_at: string;
  /** Real usage, computed server-side from `subscriptions`/`payments` — not the link's face value. */
  active_subscribers?: number;
  total_received?: number;
};

export type ActorCustomPlan = {
  id: string;
  actor_id: string;
  name: string;
  billing_period: "MONTHLY" | "ANNUAL";
  value: number;
  max_installments: number | null;
  status: "ACTIVE" | "INACTIVE";
  created_at: string;
};

export type CustomerAttribution = {
  id: string;
  customer_external_id: string;
  partner_actor_id: string | null;
  external_sales_actor_id: string | null;
  payment_link_id: string | null;
  attributed_at: string;
  notes: string | null;
};

export type Customer = {
  id: string;
  external_office_id: string | null;
  office_name: string;
  responsible_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  service_area: string | null;
  status: "ACTIVE" | "CANCELLED" | "FROZEN";
  onboarding_completed: boolean;
  source_channel: string | null;
  acquisition_actor_id: string | null;
  asaas_customer_id: string | null;
  signed_at: string | null;
  cancelled_at: string | null;
  cancellation_category: string | null;
  cancellation_reason: string | null;
  comments: string | null;
  implementation_date: string | null;
  implementation_value: number | null;
  api_oficial: boolean;
  created_at: string;
};

export type Subscription = {
  id: string;
  customer_id: string;
  plan_id: string | null;
  custom_plan_id: string | null;
  plan_name_raw: string | null;
  payment_link_id: string | null;
  actor_id: string | null;
  billing_period: "MONTHLY" | "ANNUAL";
  value: number;
  payment_method: string | null;
  installments: number | null;
  // Nullable on purpose: after the operator-driven reset (Sep/2026) every
  // subscription starts with no status until manually confirmed, instead of
  // inheriting a possibly-stale ACTIVE/FROZEN/CANCELLED from before the
  // switch to manual operation. Sync (`lib/payment-sync.ts`) still sets it
  // to ACTIVE automatically whenever a real paid payment lands.
  status: "ACTIVE" | "CANCELLED" | "FROZEN" | null;
  asaas_subscription_id: string | null;
  asaas_installment_id: string | null;
  started_at: string | null;
  cancelled_at: string | null;
  source: "SYSTEM" | "LEGACY_IMPORT" | "MANUAL";
  created_at: string;
};

export type Payment = {
  id: string;
  subscription_id: string | null;
  payment_link_id: string | null;
  customer_id: string | null;
  asaas_payment_id: string;
  status: string;
  value: number;
  net_value: number | null;
  billing_type: string | null;
  due_date: string | null;
  payment_date: string | null;
  confirmed_date: string | null;
  created_at: string;
};

export const PAID_PAYMENT_STATUSES = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
export function isPaidStatus(status: string) {
  return PAID_PAYMENT_STATUSES.has(status);
}

/**
 * A payment made against an IMPLEMENTATION-kind plan/link (one-time setup
 * fee — API Oficial da Meta, integração Claude/IA, etc.). Kept fully
 * separate from `Payment`/`Subscription`: it never represents or feeds
 * MRR, it's just "cliente X pagou a implantação Y em tal data".
 */
export type ImplementationPayment = {
  id: string;
  customer_id: string | null;
  actor_id: string | null;
  payment_link_id: string | null;
  plan_id: string | null;
  asaas_payment_id: string;
  description: string;
  status: string;
  value: number;
  net_value: number | null;
  billing_type: string | null;
  due_date: string | null;
  payment_date: string | null;
  confirmed_date: string | null;
  created_at: string;
};

/** Real cash collected from implantação fees in a period — same "paid statuses" rule as `sumRealizedRevenue`. */
export function sumImplementationRevenue(payments: ImplementationPayment[]) {
  return payments.filter((payment) => isPaidStatus(payment.status)).reduce((sum, payment) => sum + Number(payment.value), 0);
}

export type ActorMetrics = { clients: number; mrr: number; links: number };

export type AuditEvent = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_email: string | null;
  created_at: string;
};

export const roleLabels: Record<CommercialActor["role"], string> = {
  PARTNER: "Parceiro",
  AMBASSADOR: "Embaixador",
  EXTERNAL_SALES: "Comercial externo",
  INTERNAL_SALES: "Comercial interno",
  INSTITUTIONAL: "Institucional",
};

/** Display label including the Plus tier for Parceiros (e.g. "Parceiro Plus"). */
export function actorCategoryLabel(actor: Pick<CommercialActor, "role" | "tier">) {
  if (actor.role === "PARTNER" && actor.tier === "PLUS") return "Parceiro Plus";
  return roleLabels[actor.role];
}

/**
 * A candidacy submitted through the public Chat Jurídico Connect form
 * (Tally), mirrored here via webhook. The form doesn't ask for a category —
 * every field below mirrors one collected in the form; `raw_payload` keeps
 * the full webhook body as a fallback for anything not mapped.
 */
export type ConnectLead = {
  id: string;
  tally_submission_id: string | null;
  tally_response_id: string | null;
  tally_form_id: string | null;
  full_name: string | null;
  email: string | null;
  whatsapp: string | null;
  applicant_type: string | null;
  cpf: string | null;
  birth_date: string | null;
  profession: string | null;
  company_name: string | null;
  job_title: string | null;
  company_legal_name: string | null;
  company_trade_name: string | null;
  company_cnpj: string | null;
  company_rep_name: string | null;
  company_rep_cpf: string | null;
  company_rep_role: string | null;
  institution_name: string | null;
  institution_legal_name: string | null;
  institution_cnpj: string | null;
  institution_type: string | null;
  institution_rep_name: string | null;
  institution_rep_role: string | null;
  institution_member_count: string | null;
  institution_scope: string | null;
  institution_actions: string | null;
  address_zip: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  activity_area: string | null;
  activity_description: string | null;
  works_with_legal_market: string | null;
  connection_types: string[] | null;
  relationship_with_offices: string | null;
  office_network_size: string | null;
  already_refers_tools: string | null;
  already_refers_tools_details: string | null;
  has_own_clients_that_benefit: string | null;
  instagram: string | null;
  linkedin: string | null;
  youtube: string | null;
  tiktok: string | null;
  twitter_x: string | null;
  website: string | null;
  other_social: string | null;
  main_channel: string | null;
  main_channel_audience_size: string | null;
  audience_description: string | null;
  produces_content_regularly: string | null;
  content_formats: string[] | null;
  collab_interest: string | null;
  participates_in_events: string | null;
  participates_in_events_details: string | null;
  motivation_why: string | null;
  motivation_success_view: string | null;
  payee_type: string | null;
  payee_name: string | null;
  payee_document: string | null;
  pix_key_type: string | null;
  pix_key: string | null;
  consent_flags: Record<string, boolean> | null;
  raw_payload: unknown;
  status: "PENDING" | "APPROVED" | "REJECTED";
  classified_as: "PARTNER" | "AMBASSADOR" | "INSTITUTIONAL" | null;
  linked_actor_id: string | null;
  reviewed_at: string | null;
  reviewed_notes: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Individual repasse % for an actor. A row with `plan_id`/`custom_plan_id`
 * both null is that actor's default/fallback rate; a row with one of them
 * set overrides the rate for sales of that specific plan (the same actor
 * can sell two plans at two different %s).
 */
export type CommissionRate = {
  id: string;
  actor_id: string;
  plan_id: string | null;
  custom_plan_id: string | null;
  rate_percent: number;
  created_at: string;
  updated_at: string;
};

/**
 * A repasse actually paid to a Parceiro/Embaixador/Comercial externo for a
 * given reference month. Rows only exist once marked as paid — pending
 * amounts are always computed live from real payments, see
 * `computeActorPayout` below.
 */
export type ActorPayout = {
  id: string;
  actor_id: string;
  reference_month: string;
  amount: number;
  computed_amount: number;
  notes: string | null;
  paid_at: string;
  created_at: string;
  updated_at: string;
};

export function monthlyValue(value: number, billingPeriod: "MONTHLY" | "ANNUAL") {
  return billingPeriod === "ANNUAL" ? value / 12 : value;
}

export const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Real (not link-face-value) metrics: MRR only counts subscriptions that
 * actually have a paid Asaas payment behind them (see `lib/payment-sync.ts`
 * — a `subscriptions` row is only created/kept ACTIVE once a payment with a
 * "paid" status comes in), and "clients" counts distinct paying customers.
 */
export function computeActorMetrics(actors: CommercialActor[], subscriptions: Subscription[], links: PaymentLink[]): Record<string, ActorMetrics> {
  const metrics: Record<string, ActorMetrics> = Object.fromEntries(actors.map((actor) => [actor.id, { clients: 0, mrr: 0, links: 0 }]));

  for (const link of links) {
    if (link.status !== "ACTIVE" || !link.actor_id) continue;
    const entry = metrics[link.actor_id];
    if (entry) entry.links += 1;
  }

  const customersByActor = new Map<string, Set<string>>();
  for (const subscription of subscriptions) {
    if (subscription.status !== "ACTIVE" || !subscription.actor_id) continue;
    const entry = metrics[subscription.actor_id];
    if (!entry) continue;
    entry.mrr += monthlyValue(subscription.value, subscription.billing_period);
    const set = customersByActor.get(subscription.actor_id) ?? new Set<string>();
    set.add(subscription.customer_id);
    customersByActor.set(subscription.actor_id, set);
  }
  for (const [actorId, set] of customersByActor) {
    metrics[actorId].clients = set.size;
  }

  return metrics;
}

/** Real cash collected in a period — sums actual paid Asaas payments, not subscription/link face value. */
export function sumRealizedRevenue(payments: Payment[]) {
  return payments.filter((payment) => isPaidStatus(payment.status)).reduce((sum, payment) => sum + Number(payment.value), 0);
}

/** "YYYY-MM" for a payment, preferring the actual settlement date over the due date. */
function paymentPeriod(payment: Payment) {
  return (payment.payment_date ?? payment.confirmed_date ?? "").slice(0, 7);
}

/**
 * Looks up the commission % that applies to a subscription's plan for a
 * given actor: a plan/custom_plan-specific override wins, falling back to
 * the actor's default rate (both plan_id/custom_plan_id null), and finally
 * `null` if the actor has no rate configured at all for this sale.
 */
function findCommissionRate(rates: CommissionRate[], actorId: string, planId: string | null, customPlanId: string | null): number | null {
  const forActor = rates.filter((rate) => rate.actor_id === actorId);
  const specific = forActor.find((rate) => (planId !== null && rate.plan_id === planId) || (customPlanId !== null && rate.custom_plan_id === customPlanId));
  if (specific) return specific.rate_percent;
  const fallback = forActor.find((rate) => rate.plan_id === null && rate.custom_plan_id === null);
  return fallback ? fallback.rate_percent : null;
}

/** Number of whole months between two "YYYY-MM" periods (b - a). */
function monthsBetween(a: string, b: string) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/**
 * Whether an ANNUAL subscription's 12-month service cycle covers `period`
 * and the subscription was still active through that month.
 *
 * Deliberately NOT tied to whether a specific installment payment landed
 * in `period`: once the customer's plan is on file (the subscription only
 * exists because at least one payment already came in — see
 * `resolveSubscription`), the annual commission is earned evenly across
 * all 12 months of that cycle regardless of whether they paid in 1x, 8x,
 * 10x or 12x. If they cancel mid-cycle, months after `cancelled_at` stop
 * counting.
 */
function isAnnualCycleMonthActive(subscription: Subscription, period: string) {
  if (!subscription.started_at) return false;
  const cycleStart = subscription.started_at.slice(0, 7);
  const offset = monthsBetween(cycleStart, period);
  if (offset < 0 || offset > 11) return false;
  if (subscription.status === "CANCELLED" && subscription.cancelled_at && monthsBetween(cycleStart, subscription.cancelled_at.slice(0, 7)) < offset) return false;
  return true;
}

/** One subscription's contribution to an actor's repasse for a given "YYYY-MM" period — the line items behind the aggregate numbers, used to build the per-partner report. */
export type PayoutLineItem = {
  subscriptionId: string;
  customerId: string;
  planName: string;
  billingPeriod: "MONTHLY" | "ANNUAL";
  subscriptionValue: number;
  commissionBase: number;
  ratePercent: number | null;
  commission: number;
  /** Only set for MONTHLY plans, where the credit is tied to a specific received payment. */
  paymentDate: string | null;
};

/**
 * Per-subscription breakdown of one actor's repasse for one "YYYY-MM"
 * period.
 *
 * - MONTHLY plans: a line only exists in months with an actual received
 *   payment (`isPaidStatus`) for that subscription — "real cash in", tied
 *   1:1 to the recurring monthly charge.
 * - ANNUAL plans: the base is the plan's MRR (annual value / 12), credited
 *   evenly across all 12 months of the subscription's cycle while it
 *   stays active (see `isAnnualCycleMonthActive`) — independent of how
 *   many installments the customer chose. A 1x, 8x, 10x or 12x payment
 *   plan for the same annual contract all earn the actor the same total
 *   commission over the year.
 *
 * `computeActorPayout` (below) is just this list aggregated; both stay in
 * lockstep because the aggregate is derived from these same line items.
 */
export function computeActorPayoutDetail(actorId: string, period: string, subscriptions: Subscription[], payments: Payment[], rates: CommissionRate[]): PayoutLineItem[] {
  const items: PayoutLineItem[] = [];
  for (const subscription of subscriptions) {
    if (subscription.actor_id !== actorId) continue;

    let commissionBase: number;
    let paymentDate: string | null = null;
    if (subscription.billing_period === "ANNUAL") {
      if (!isAnnualCycleMonthActive(subscription, period)) continue;
      commissionBase = monthlyValue(subscription.value, subscription.billing_period);
    } else {
      const payment = payments.find((candidate) => candidate.subscription_id === subscription.id && isPaidStatus(candidate.status) && paymentPeriod(candidate) === period);
      if (!payment) continue;
      commissionBase = subscription.value;
      paymentDate = payment.payment_date ?? payment.confirmed_date ?? null;
    }

    const ratePercent = findCommissionRate(rates, actorId, subscription.plan_id, subscription.custom_plan_id);
    items.push({
      subscriptionId: subscription.id,
      customerId: subscription.customer_id,
      planName: subscription.plan_name_raw ?? "Plano",
      billingPeriod: subscription.billing_period,
      subscriptionValue: subscription.value,
      commissionBase,
      ratePercent,
      commission: ratePercent === null ? 0 : commissionBase * (ratePercent / 100),
      paymentDate,
    });
  }
  return items;
}

/**
 * Aggregate monthly repasse owed to one actor for one "YYYY-MM" period —
 * see `computeActorPayoutDetail` for the per-subscription breakdown this
 * is built from. `grossReceived` is purely informational (actual cash that
 * landed this period across the actor's subscriptions) and doesn't drive
 * the commission math for annual plans.
 */
export function computeActorPayout(actorId: string, period: string, subscriptions: Subscription[], payments: Payment[], rates: CommissionRate[]) {
  const items = computeActorPayoutDetail(actorId, period, subscriptions, payments, rates);

  let grossReceived = 0;
  for (const payment of payments) {
    if (!isPaidStatus(payment.status) || paymentPeriod(payment) !== period) continue;
    if (payment.subscription_id && subscriptions.some((subscription) => subscription.id === payment.subscription_id && subscription.actor_id === actorId)) {
      grossReceived += Number(payment.value);
    }
  }

  let commission = 0;
  let untaxedGross = 0;
  let untaxedCount = 0;
  for (const item of items) {
    if (item.ratePercent === null) { untaxedGross += item.commissionBase; untaxedCount += 1; continue; }
    commission += item.commission;
  }

  return { grossReceived, commission, untaxedGross, untaxedCount };
}
