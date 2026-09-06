import { fetchAsaasCustomer, type AsaasCustomer, type AsaasPayment } from "@/lib/asaas";
import { findClientInSheet } from "@/lib/clients-allowlist";
import { isOneTimePlanKind, type Plan } from "@/lib/metrics";
import { supabaseRequest } from "@/lib/supabase-server";

type PaymentLinkRow = {
  id: string;
  actor_id: string | null;
  plan_id: string | null;
  custom_plan_id: string | null;
  display_name: string;
  billing_period: "MONTHLY" | "ANNUAL" | "ONE_TIME";
  value: number;
  /** Kind of the bound plan, if any — IMPLEMENTATION/CONSULTING route the payment to `implementation_payments` instead of subscriptions/payments (see `isOneTimePlanKind`). Unbound links (plan_id null) behave like RECURRING, matching prior behavior. */
  plan_kind: Plan["kind"] | null;
};
type CustomerRow = { id: string; email: string | null; asaas_customer_id: string | null; acquisition_actor_id: string | null; status: string };
type SubscriptionRow = { id: string; status: string; asaas_subscription_id: string | null; asaas_installment_id: string | null };
/** Full shape needed to keep tracking a subscription whose payments stopped carrying a `paymentLink` (see `resolveOrphanSubscription`). */
type SubscriptionFullRow = SubscriptionRow & {
  customer_id: string;
  plan_id: string | null;
  custom_plan_id: string | null;
  plan_name_raw: string | null;
  payment_link_id: string | null;
  actor_id: string | null;
  billing_period: "MONTHLY" | "ANNUAL";
  value: number;
};
const SUBSCRIPTION_FULL_SELECT = "id,status,asaas_subscription_id,asaas_installment_id,customer_id,plan_id,custom_plan_id,plan_name_raw,payment_link_id,actor_id,billing_period,value";

const PAID_STATUSES = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);

async function findOne<T>(path: string): Promise<T | null> {
  const rows = await supabaseRequest<T[]>(path);
  return rows[0] ?? null;
}

type PaymentLinkRawRow = Omit<PaymentLinkRow, "plan_kind"> & { plans: { kind: Plan["kind"] } | null };

async function resolvePaymentLink(asaasPaymentLinkId: string | null | undefined): Promise<PaymentLinkRow | null> {
  if (!asaasPaymentLinkId) return null;
  const row = await findOne<PaymentLinkRawRow>(
    `/rest/v1/payment_links?select=id,actor_id,plan_id,custom_plan_id,display_name,billing_period,value,plans(kind)&asaas_payment_link_id=eq.${encodeURIComponent(asaasPaymentLinkId)}`,
  );
  if (!row) return null;
  const { plans, ...rest } = row;
  return { ...rest, plan_kind: plans?.kind ?? null };
}

async function resolveCustomer(payment: AsaasPayment, link: PaymentLinkRow): Promise<CustomerRow | null> {
  const existing = await findOne<CustomerRow>(
    `/rest/v1/customers?select=id,email,asaas_customer_id,acquisition_actor_id,status&asaas_customer_id=eq.${encodeURIComponent(payment.customer)}`,
  );
  if (existing) return existing;

  let details: Partial<AsaasCustomer> = {};
  try {
    details = await fetchAsaasCustomer(payment.customer);
  } catch {
    // Without a verified match, leave the payment pending for a later sync.
  }

  if (details.email) {
    const matches = await supabaseRequest<CustomerRow[]>(
      `/rest/v1/customers?select=id,email,asaas_customer_id,acquisition_actor_id,status&email=eq.${encodeURIComponent(details.email)}&asaas_customer_id=is.null`,
    );
    const byEmail = matches.length === 1 ? matches[0] : null;
    if (byEmail) {
      const [updated] = await supabaseRequest<CustomerRow[]>(`/rest/v1/customers?id=eq.${byEmail.id}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { asaas_customer_id: payment.customer },
      });
      return updated;
    }
  }

  // Nobody in our database matches this Asaas customer yet: this is a
  // brand-new client. The "⭐ Base de Clientes" sheet (Nome, Email, Telefone,
  // OfficeId) is the single manual intake point — we only auto-create a
  // customer record here if it's listed there, or if the gate isn't
  // configured at all (CLIENTS_SHEET_WEBHOOK_URL unset), in which case
  // everything Asaas reports is trusted directly. Once created, this row is
  // never touched by the sheet again: from here on Supabase is the source
  // of truth and edits made in the app (plan changes, status, etc.) are
  // final.
  const gateEnabled = Boolean(process.env.CLIENTS_SHEET_WEBHOOK_URL);
  const sheetRow = details.email ? await findClientInSheet(details.email) : null;
  if (gateEnabled && !sheetRow) return null;

  // Same office, second Asaas customer id: happens when a client ends up
  // with more than one Asaas customer record for the same office (re-signed
  // up, different document/email on a later purchase, etc.). `external_office_id`
  // is unique per office, so inserting a second customer row for it would
  // violate that constraint — reuse the existing office record instead of
  // creating a duplicate. Its `asaas_customer_id` stays pointed at whichever
  // Asaas identity was seen first; this payment's `payment.customer` is a
  // different id for the same real client, so subscriptions/payments below
  // still attach correctly via `customer_id`.
  if (sheetRow?.officeId) {
    const byOffice = await findOne<CustomerRow>(
      `/rest/v1/customers?select=id,email,asaas_customer_id,acquisition_actor_id,status&external_office_id=eq.${encodeURIComponent(sheetRow.officeId)}`,
    );
    if (byOffice) return byOffice;
  }

  const [created] = await supabaseRequest<CustomerRow[]>("/rest/v1/customers", {
    method: "POST",
    prefer: "return=representation",
    body: {
      asaas_customer_id: payment.customer,
      external_office_id: sheetRow?.officeId ?? null,
      office_name: sheetRow?.officeName ?? details.name ?? "Sem nome",
      responsible_name: sheetRow?.responsibleName ?? details.name ?? null,
      email: details.email ?? null,
      phone: sheetRow?.phone ?? details.mobilePhone ?? details.phone ?? null,
      acquisition_actor_id: link.actor_id,
      source_channel: "ASAAS_SYNC",
      status: "ACTIVE",
    },
  });
  return created ?? null;
}

async function resolveSubscription(payment: AsaasPayment, link: PaymentLinkRow, customer: CustomerRow): Promise<SubscriptionRow> {
  let existing: SubscriptionRow | null = null;
  if (payment.subscription) {
    existing = await findOne<SubscriptionRow>(`/rest/v1/subscriptions?select=id,status,asaas_subscription_id,asaas_installment_id&asaas_subscription_id=eq.${encodeURIComponent(payment.subscription)}`);
  } else if (payment.installment) {
    existing = await findOne<SubscriptionRow>(`/rest/v1/subscriptions?select=id,status,asaas_subscription_id,asaas_installment_id&asaas_installment_id=eq.${encodeURIComponent(payment.installment)}`);
  }
  // Either this payment carries no subscription/installment id at all (the
  // very first payment on a link, before Asaas assigns one), or it carries
  // one that's new to us — which can happen more than once over a client's
  // lifetime: Asaas can recreate/reassign a subscription's id mid-relationship
  // (payment method change, manual edit in their dashboard, etc.), and each
  // time it does, the *old* id simply stops appearing on new payments. Both
  // cases fall back to "this customer's one live (non-cancelled) row for
  // this exact link" and adopt whatever id this payment carries onto it,
  // instead of spawning a new row every time the id changes — which used to
  // silently fragment a client's payment history across multiple rows (e.g.
  // Abussafi: 3 rows for one real subscription, each only seeing part of
  // the payments, discovered across two separate rescans).
  if (!existing) {
    const candidates = await supabaseRequest<SubscriptionRow[]>(
      `/rest/v1/subscriptions?select=id,status,asaas_subscription_id,asaas_installment_id&customer_id=eq.${customer.id}&payment_link_id=eq.${link.id}&status=neq.CANCELLED`,
    );
    if (candidates.length === 1) {
      existing = candidates[0];
    } else if (candidates.length > 1) {
      // Shouldn't normally happen post-fix, but if it does (e.g. a rescan
      // racing itself), pick whichever was paid most recently rather than
      // fragmenting further; older duplicates get cleaned up separately.
      const withLastPaid = await Promise.all(
        candidates.map(async (row) => {
          const last = await findOne<{ due_date: string | null }>(`/rest/v1/payments?select=due_date&subscription_id=eq.${row.id}&order=due_date.desc,id.desc&limit=1`);
          return { row, lastDate: last?.due_date ?? "" };
        }),
      );
      withLastPaid.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
      existing = withLastPaid[0].row;
    }
  }

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (payment.subscription && payment.subscription !== existing.asaas_subscription_id) patch.asaas_subscription_id = payment.subscription;
    if (payment.installment && payment.installment !== existing.asaas_installment_id) patch.asaas_installment_id = payment.installment;
    if (PAID_STATUSES.has(payment.status) && existing.status !== "ACTIVE") patch.status = "ACTIVE";
    if (Object.keys(patch).length > 0) {
      const [updated] = await supabaseRequest<SubscriptionRow[]>(`/rest/v1/subscriptions?id=eq.${existing.id}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: patch,
      });
      return updated;
    }
    return existing;
  }

  const [created] = await supabaseRequest<SubscriptionRow[]>("/rest/v1/subscriptions", {
    method: "POST",
    prefer: "return=representation",
    body: {
      customer_id: customer.id,
      plan_id: link.plan_id,
      custom_plan_id: link.custom_plan_id,
      plan_name_raw: link.display_name,
      payment_link_id: link.id,
      actor_id: link.actor_id,
      // Only one-time-kind links (IMPLEMENTATION/CONSULTING) carry
      // billing_period "ONE_TIME", and those are routed to
      // `implementation_payments` before reaching this function (see
      // `syncAsaasPayment`) — so this is always MONTHLY/ANNUAL here,
      // matching `subscriptions.billing_period`'s check constraint.
      billing_period: link.billing_period as "MONTHLY" | "ANNUAL",
      // Use the link's face value, not this specific payment's value: for an
      // ANNUAL plan paid in N>1 installments, Asaas splits the total into N
      // equal payments, so payment.value here would only be 1/N of the real
      // annual contract value — link.value is always the full amount
      // regardless of how the customer chose to split it.
      value: link.value,
      payment_method: payment.billingType ?? null,
      status: PAID_STATUSES.has(payment.status) ? "ACTIVE" : "FROZEN",
      asaas_subscription_id: payment.subscription ?? null,
      asaas_installment_id: payment.installment ?? null,
      started_at: payment.paymentDate ?? payment.dueDate ?? new Date().toISOString().slice(0, 10),
      source: "SYSTEM",
    },
  });
  return created;
}

/**
 * Idempotently reflects a payment against a one-time-kind plan/link
 * (IMPLEMENTATION — API Oficial da Meta, integração Claude/IA, etc. — or
 * CONSULTING — assessoria/consultoria avulsa) into `implementation_payments`.
 * Deliberately does NOT touch subscriptions/payments: neither of these
 * represents or feeds MRR. `plan_id` on the row still tells the two apart
 * via the linked plan's `kind`, if a report ever needs to split them.
 */
async function upsertImplementationPayment(payment: AsaasPayment, link: PaymentLinkRow, customer: CustomerRow) {
  const body = {
    customer_id: customer.id,
    actor_id: link.actor_id,
    payment_link_id: link.id,
    plan_id: link.plan_id,
    asaas_payment_id: payment.id,
    description: link.display_name,
    status: payment.status,
    value: payment.value,
    net_value: payment.netValue ?? null,
    billing_type: payment.billingType ?? null,
    due_date: payment.dueDate ?? null,
    payment_date: payment.paymentDate ?? payment.clientPaymentDate ?? null,
    confirmed_date: payment.confirmedDate ?? null,
    raw_payload: payment,
  };
  const existing = await findOne<{ id: string }>(`/rest/v1/implementation_payments?select=id&asaas_payment_id=eq.${encodeURIComponent(payment.id)}`);
  if (existing) {
    await supabaseRequest(`/rest/v1/implementation_payments?id=eq.${existing.id}`, { method: "PATCH", body });
    return "updated" as const;
  }
  await supabaseRequest("/rest/v1/implementation_payments", { method: "POST", body });
  return "created" as const;
}

async function upsertPaymentRow(payment: AsaasPayment, paymentLinkId: string | null, customer: CustomerRow, subscription: SubscriptionRow) {
  const body = {
    subscription_id: subscription.id,
    payment_link_id: paymentLinkId,
    customer_id: customer.id,
    asaas_payment_id: payment.id,
    status: payment.status,
    value: payment.value,
    net_value: payment.netValue ?? null,
    billing_type: payment.billingType ?? null,
    due_date: payment.dueDate ?? null,
    payment_date: payment.paymentDate ?? payment.clientPaymentDate ?? null,
    confirmed_date: payment.confirmedDate ?? null,
    raw_payload: payment,
  };
  const existing = await findOne<{ id: string }>(`/rest/v1/payments?select=id&asaas_payment_id=eq.${encodeURIComponent(payment.id)}`);
  if (existing) {
    await supabaseRequest(`/rest/v1/payments?id=eq.${existing.id}`, { method: "PATCH", body });
    return "updated" as const;
  }
  await supabaseRequest("/rest/v1/payments", { method: "POST", body });
  return "created" as const;
}

/**
 * Finds the subscription a `paymentLink`-less payment belongs to, so a
 * client whose plan/value was edited directly in Asaas (not through one of
 * our links) doesn't just vanish from their payment history.
 *
 * Real case that surfaced this: a client signed up via a link (MONTHLY,
 * R$597), and was later moved to a different Asaas subscription with a
 * different value — apparently adjusted directly in Asaas, since every
 * payment since then carries no `paymentLink` at all. Without this, only
 * the first 3 payments (the original subscription) ever showed up for
 * them; everything paid after the migration was silently dropped.
 *
 * Matches by the payment's own subscription/installment id first (an
 * already-migrated subscription, on its 2nd+ payment). For the *first*
 * payment of a brand-new id we have no direct match, so we fall back to
 * "this customer's one subscription" — safe only when unambiguous (exactly
 * one row, or exactly one ACTIVE one). With 2+ ACTIVE candidates we only
 * still resolve it when they're clearly duplicates of the very same
 * underlying subscription (same payment link, or same plan if there's no
 * link) rather than genuinely distinct products — in that case the one
 * with the most recent payment wins, since it's the row this migration is
 * continuing. Otherwise we skip rather than guess.
 */
async function resolveOrphanSubscription(payment: AsaasPayment, customer: CustomerRow): Promise<SubscriptionFullRow | null> {
  if (payment.subscription) {
    const bySubscription = await findOne<SubscriptionFullRow>(
      `/rest/v1/subscriptions?select=${SUBSCRIPTION_FULL_SELECT}&asaas_subscription_id=eq.${encodeURIComponent(payment.subscription)}`,
    );
    if (bySubscription) return bySubscription;
  }
  if (payment.installment) {
    const byInstallment = await findOne<SubscriptionFullRow>(
      `/rest/v1/subscriptions?select=${SUBSCRIPTION_FULL_SELECT}&asaas_installment_id=eq.${encodeURIComponent(payment.installment)}`,
    );
    if (byInstallment) return byInstallment;
  }
  const candidates = await supabaseRequest<SubscriptionFullRow[]>(
    `/rest/v1/subscriptions?select=${SUBSCRIPTION_FULL_SELECT}&customer_id=eq.${customer.id}`,
  );
  if (candidates.length === 1) return candidates[0];
  const active = candidates.filter((row) => row.status === "ACTIVE");
  if (active.length === 1) return active[0];
  if (active.length > 1) {
    const sameLink = new Set(active.map((row) => row.payment_link_id)).size === 1;
    const samePlan = new Set(active.map((row) => row.plan_id ?? row.custom_plan_id ?? row.plan_name_raw)).size === 1;
    if (sameLink || samePlan) {
      const withLastPaid = await Promise.all(
        active.map(async (row) => {
          const last = await findOne<{ due_date: string | null }>(`/rest/v1/payments?select=due_date&subscription_id=eq.${row.id}&order=due_date.desc,id.desc&limit=1`);
          return { row, lastDate: last?.due_date ?? "" };
        }),
      );
      withLastPaid.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
      return withLastPaid[0].row;
    }
  }
  return null;
}

/**
 * Points the subscription at this payment's (new) subscription/installment
 * id and, for MONTHLY plans, adopts this payment's value as the new face
 * value — once there's no link left to read a face value from, the paid
 * amount is the only source of truth. Left untouched for ANNUAL plans:
 * a single installment's value there is a fraction of the real annual
 * total, so guessing would silently corrupt the MRR figure instead of just
 * missing a payment; fix those manually via the customer's "Acompanhamento"
 * timeline if a real value change happened.
 */
async function migrateOrphanSubscription(subscription: SubscriptionFullRow, payment: AsaasPayment): Promise<SubscriptionFullRow> {
  const paid = PAID_STATUSES.has(payment.status);
  const body: Record<string, unknown> = {};
  if (payment.subscription && payment.subscription !== subscription.asaas_subscription_id) body.asaas_subscription_id = payment.subscription;
  if (payment.installment && payment.installment !== subscription.asaas_installment_id) body.asaas_installment_id = payment.installment;
  if (paid && subscription.billing_period === "MONTHLY" && payment.value !== subscription.value) body.value = payment.value;
  if (paid && subscription.status !== "ACTIVE") body.status = "ACTIVE";
  if (Object.keys(body).length === 0) return subscription;
  const [updated] = await supabaseRequest<SubscriptionFullRow[]>(`/rest/v1/subscriptions?id=eq.${subscription.id}`, {
    method: "PATCH",
    prefer: "return=representation",
    body,
  });
  return { ...subscription, ...updated };
}

/**
 * Idempotently reflects a single Asaas payment (from a webhook delivery or a
 * manual sync) into customers/subscriptions/payments. Shared by the webhook
 * receiver and the manual sync route so both paths stay in lockstep.
 *
 * Requires the payment to resolve to either one of *our* generated
 * payment_links, or (when there's no `paymentLink` at all) to a customer and
 * subscription we already track — see `resolveOrphanSubscription`. The same
 * Asaas account can carry unrelated activity (other products, sandbox demo
 * data), so anything that can't be tied to something we already recognize is
 * skipped rather than guessed at.
 */
export async function syncAsaasPayment(payment: AsaasPayment) {
  if (payment.paymentLink) {
    const link = await resolvePaymentLink(payment.paymentLink);
    if (!link) return { result: "skipped" as const, reason: `paymentLink ${payment.paymentLink} is not one of ours` };

    const customer = await resolveCustomer(payment, link);
    if (!customer) return { result: "skipped" as const, reason: "E-mail do pagador não encontrado na aba ⭐ Base de Clientes; inclua-o lá para permitir a criação automática do cliente." };

    // Implantação (taxa única — API Oficial da Meta, Claude/IA, etc.) ou
    // Consultoria (assessoria avulsa): ambas têm seu próprio ledger e nunca
    // criam assinatura/MRR.
    if (isOneTimePlanKind(link.plan_kind)) {
      const result = await upsertImplementationPayment(payment, link, customer);
      return { result, customerId: customer.id, subscriptionId: null, linkId: link.id, implementation: true as const };
    }

    const subscription = await resolveSubscription(payment, link, customer);
    const result = await upsertPaymentRow(payment, link.id, customer, subscription);
    return { result, customerId: customer.id, subscriptionId: subscription.id, linkId: link.id };
  }

  // No paymentLink on this payment: only trust it if it clearly continues a
  // customer/subscription we already track (see resolveOrphanSubscription).
  const customer = await findOne<CustomerRow>(
    `/rest/v1/customers?select=id,email,asaas_customer_id,acquisition_actor_id,status&asaas_customer_id=eq.${encodeURIComponent(payment.customer)}`,
  );
  if (!customer) return { result: "skipped" as const, reason: "no paymentLink and this Asaas customer isn't one of ours yet" };

  const existingSubscription = await resolveOrphanSubscription(payment, customer);
  if (!existingSubscription) return { result: "skipped" as const, reason: "no paymentLink and no existing subscription to attach this payment to" };

  const subscription = await migrateOrphanSubscription(existingSubscription, payment);
  const result = await upsertPaymentRow(payment, subscription.payment_link_id, customer, subscription);
  return { result, customerId: customer.id, subscriptionId: subscription.id, linkId: subscription.payment_link_id };
}
