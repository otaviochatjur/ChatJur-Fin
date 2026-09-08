import { asaasRequest, type AsaasCustomer, type AsaasPayment } from "./asaas";
import { rulesForCustomer } from "./collection-rules";
import type { CollectionSettings } from "./collection-rules";
import { canonicalBillingPayment, previewCollection, type BillingContact, type BillingTemplate } from "./collection-policy";
import type { CollectionCalendar } from "./collection-calendar";
import type { CollectionScheduleConfig } from "./collection-schedule";
import { supabaseRequest } from "./supabase-server";

type StoredCustomer = {
  id: string;
  asaas_customer_id: string;
  status: "ACTIVE" | "CANCELLED" | "FROZEN" | null;
  phone: string | null;
  responsible_name: string | null;
  office_name: string | null;
};

export function normalizeCollectionPhone(value: string | null | undefined) {
  let phone = value?.replace(/\D/g, "") ?? "";
  if (phone.startsWith("0") && phone.length >= 11) phone = phone.slice(1);
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  return phone.length >= 12 && phone.length <= 13 ? phone : null;
}

export async function freshCollectionPreview(
  asaasPaymentId: string,
  instanceId: string,
  availableTemplates: BillingTemplate[],
  settings: CollectionSettings,
  today: string,
  schedule?: CollectionScheduleConfig,
  calendar?: CollectionCalendar,
) {
  const source = await asaasRequest<AsaasPayment & { invoiceUrl?: string; deleted?: boolean }>(`/payments/${encodeURIComponent(asaasPaymentId)}`);
  const [payer, storedRows] = await Promise.all([
    asaasRequest<AsaasCustomer>(`/customers/${encodeURIComponent(source.customer)}`),
    supabaseRequest<StoredCustomer[]>(`/rest/v1/customers?select=id,asaas_customer_id,status,phone,responsible_name,office_name&asaas_customer_id=eq.${encodeURIComponent(source.customer)}&order=id.asc&limit=1`),
  ]);
  const stored = storedRows[0];
  const phone = normalizeCollectionPhone(payer.mobilePhone || payer.phone) ?? normalizeCollectionPhone(stored?.phone);
  const contact: BillingContact = {
    id: stored?.id ?? `asaas:${source.customer}`,
    name: stored?.responsible_name ?? stored?.office_name ?? payer.name ?? "Cliente não identificado",
    phone,
    is_active: stored?.status === "ACTIVE",
    instance_id: null,
    status: stored?.status,
  };
  const payment = canonicalBillingPayment({
    id: source.id,
    asaas_payment_id: source.id,
    contact_id: contact.id,
    contact_name: contact.name,
    chat_id: null,
    due_date: source.dueDate ?? null,
    value: Number(source.value),
    status: source.deleted ? "DELETED" : source.status,
    invoice_url: source.invoiceUrl ?? null,
  });
  return previewCollection(payment, stored ? contact : null, availableTemplates, today, rulesForCustomer(settings, source.customer), calendar ?? schedule, instanceId);
}
