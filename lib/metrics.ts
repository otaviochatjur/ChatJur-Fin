export type CommercialActor = {
  id: string;
  name: string;
  role: "PARTNER" | "AMBASSADOR" | "EXTERNAL_SALES";
  email: string | null;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  notes: string | null;
  created_at: string;
};

export type Plan = {
  id: string;
  code: string;
  name: string;
  billing_period: "MONTHLY" | "ANNUAL";
  standard_value: number;
  annual_installment_limit: number | null;
  status: "ACTIVE" | "INACTIVE";
};

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
  actor_id: string;
  plan_id: string | null;
  price_version_id: string | null;
  url: string | null;
  display_name: string;
  value: number;
  billing_period: "MONTHLY" | "ANNUAL";
  max_installments: number | null;
  status: "ACTIVE" | "INACTIVE" | "PENDING";
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
};

export function monthlyValue(value: number, billingPeriod: "MONTHLY" | "ANNUAL") {
  return billingPeriod === "ANNUAL" ? value / 12 : value;
}

export const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function computeActorMetrics(actors: CommercialActor[], links: PaymentLink[], attributions: CustomerAttribution[]): Record<string, ActorMetrics> {
  const linkById = new Map(links.map((link) => [link.id, link]));
  const metrics: Record<string, ActorMetrics> = Object.fromEntries(actors.map((actor) => [actor.id, { clients: 0, mrr: 0, links: 0 }]));

  for (const link of links) {
    if (link.status !== "ACTIVE") continue;
    const entry = metrics[link.actor_id];
    if (entry) entry.links += 1;
  }

  for (const attribution of attributions) {
    const link = attribution.payment_link_id ? linkById.get(attribution.payment_link_id) : undefined;
    const mrr = link ? monthlyValue(link.value, link.billing_period) : 0;
    for (const actorId of [attribution.partner_actor_id, attribution.external_sales_actor_id]) {
      if (!actorId) continue;
      const entry = metrics[actorId];
      if (!entry) continue;
      entry.clients += 1;
      entry.mrr += mrr;
    }
  }

  return metrics;
}
