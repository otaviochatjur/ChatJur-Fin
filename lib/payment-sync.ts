import { fetchAsaasCustomer, type AsaasCustomer, type AsaasPayment } from "@/lib/asaas";
import { supabaseRequest } from "@/lib/supabase-server";

type PaymentLinkRow = { id: string; actor_id: string; plan_id: string | null; custom_plan_id: string | null; display_name: string; billing_period: "MONTHLY" | "ANNUAL"; value: number };
type CustomerRow = { id: string; email: string | null; asaas_customer_id: string | null; acquisition_actor_id: string | null; status: string };
type SubscriptionRow = { id: string; status: string; asaas_subscription_id: string | null; asaas_installment_id: string | null };

const PAID_STATUSES = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);

async function findOne<T>(path: string): Promise<T | null> {
  const rows = await supabaseRequest<T[]>(path);
  return rows[0] ?? null;
}

async function resolvePaymentLink(asaasPaymentLinkId: string | null | undefined): Promise<PaymentLinkRow | null> {
  if (!asaasPaymentLinkId) return null;
  return findOne<PaymentLinkRow>(
    `/rest/v1/payment_links?select=id,actor_id,plan_id,custom_plan_id,display_name,billing_period,value&asaas_payment_link_id=eq.${encodeURIComponent(asaasPaymentLinkId)}`,
  );
}

async function resolveCustomer(payment: AsaasPayment): Promise<CustomerRow | null> {
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

  return null;
}

async function resolveSubscription(payment: AsaasPayment, link: PaymentLinkRow, customer: CustomerRow): Promise<SubscriptionRow> {
  let existing: SubscriptionRow | null = null;
  if (payment.subscription) {
    existing = await findOne<SubscriptionRow>(`/rest/v1/subscriptions?select=id,status,asaas_subscription_id,asaas_installment_id&asaas_subscription_id=eq.${encodeURIComponent(payment.subscription)}`);
  } else if (payment.installment) {
    existing = await findOne<SubscriptionRow>(`/rest/v1/subscriptions?select=id,status,asaas_subscription_id,asaas_installment_id&asaas_installment_id=eq.${encodeURIComponent(payment.installment)}`);
  } else {
    existing = await findOne<SubscriptionRow>(`/rest/v1/subscriptions?select=id,status,asaas_subscription_id,asaas_installment_id&customer_id=eq.${customer.id}&payment_link_id=eq.${link.id}&asaas_subscription_id=is.null&asaas_installment_id=is.null`);
  }

  if (existing) {
    if (PAID_STATUSES.has(payment.status) && existing.status !== "ACTIVE") {
      const [updated] = await supabaseRequest<SubscriptionRow[]>(`/rest/v1/subscriptions?id=eq.${existing.id}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { status: "ACTIVE" },
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
      billing_period: link.billing_period,
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

async function upsertPaymentRow(payment: AsaasPayment, link: PaymentLinkRow, customer: CustomerRow, subscription: SubscriptionRow) {
  const body = {
    subscription_id: subscription.id,
    payment_link_id: link.id,
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
 * Idempotently reflects a single Asaas payment (from a webhook delivery or a
 * manual `/payments?paymentLink=` sync) into customers/subscriptions/payments.
 * Shared by the webhook receiver and the manual sync route so both paths stay
 * in lockstep.
 *
 * Strictly requires the payment to resolve to one of *our* generated
 * payment_links. The same Asaas account can carry unrelated activity (other
 * products, sandbox demo data, Asaas's own `paymentLink` query filter not
 * being fully reliable) — without this guard a sync/webhook could ingest
 * completely unrelated customers/payments into this CRM.
 */
export async function syncAsaasPayment(payment: AsaasPayment) {
  if (!payment.paymentLink) return { result: "skipped" as const, reason: "no paymentLink on this payment" };
  const link = await resolvePaymentLink(payment.paymentLink);
  if (!link) return { result: "skipped" as const, reason: `paymentLink ${payment.paymentLink} is not one of ours` };

  const customer = await resolveCustomer(payment);
  if (!customer) return { result: "skipped" as const, reason: "Cliente ainda não cadastrado pela base do Sheets; sincronize novamente após a importação." };
  const subscription = await resolveSubscription(payment, link, customer);
  const result = await upsertPaymentRow(payment, link, customer, subscription);
  return { result, customerId: customer.id, subscriptionId: subscription.id, linkId: link.id };
}
