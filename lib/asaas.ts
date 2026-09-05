type AsaasRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | undefined>;
};

export function getAsaasConfig() {
  const apiKey = process.env.ASAAS_API_KEY;
  const baseUrl = process.env.ASAAS_BASE_URL ?? "https://api-sandbox.asaas.com/v3";
  if (!apiKey) return null;
  return { apiKey, baseUrl };
}

export async function asaasRequest<T>(path: string, options: AsaasRequestOptions = {}): Promise<T> {
  const config = getAsaasConfig();
  if (!config) throw new Error("A integração com o Asaas ainda não foi configurada.");
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ChatJuridicoFinanceiro/1.0",
      access_token: config.apiKey,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.errors?.[0]?.description ?? `Asaas respondeu ${response.status}.`);
  return data as T;
}

/** Shape of the payment object as returned both by Asaas webhooks and by the payments REST endpoints. */
export type AsaasPayment = {
  id: string;
  customer: string;
  subscription?: string | null;
  installment?: string | null;
  paymentLink?: string | null;
  value: number;
  netValue?: number | null;
  billingType?: string | null;
  status: string;
  dueDate?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  externalReference?: string | null;
  description?: string | null;
};

export type AsaasCustomer = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  city?: string | null;
  state?: string | null;
};

export function fetchAsaasCustomer(customerId: string) {
  return asaasRequest<AsaasCustomer>(`/customers/${encodeURIComponent(customerId)}`);
}

/**
 * `since` (ISO date, e.g. "2026-08-01") filters to payments created on/after
 * that date via Asaas's `dateCreated[ge]`, so a repeat sync doesn't re-walk a
 * link's entire history — some payment links here have 3-4 thousand
 * payments (e.g. a shared/generic link reused across many clients over
 * time), which at Asaas's own ~2-4s per 100-item page took minutes for a
 * *single* link. Omit `since` for a link's first-ever sync (full history).
 */
export function listAsaasPaymentsForLink(asaasPaymentLinkId: string, offset = 0, since?: string) {
  return asaasRequest<{ data: AsaasPayment[]; hasMore: boolean; totalCount: number }>("/payments", {
    query: { paymentLink: asaasPaymentLinkId, limit: "100", offset: String(offset), "dateCreated[ge]": since },
  });
}

/** Shape of the payment link object as returned by GET /paymentLinks — includes links created directly in the Asaas dashboard, not just the ones this app generated. */
export type AsaasPaymentLink = {
  id: string;
  name?: string | null;
  url?: string | null;
  value?: number | null;
  billingType?: string | null;
  chargeType?: "DETACHED" | "RECURRENT" | "INSTALLMENT" | null;
  subscriptionCycle?: string | null;
  maxInstallmentCount?: number | null;
  externalReference?: string | null;
  deleted?: boolean;
};

export function listAllAsaasPaymentLinks(offset = 0) {
  return asaasRequest<{ data: AsaasPaymentLink[]; hasMore: boolean; totalCount: number }>("/paymentLinks", {
    query: { limit: "100", offset: String(offset) },
  });
}
