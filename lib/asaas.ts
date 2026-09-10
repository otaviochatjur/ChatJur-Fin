import { currentTenant } from "./tenant-server";
import { asaasBaseUrl, readIntegrationKey } from "./integrations-server";
type AsaasRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | undefined>;
  body?: unknown;
};

export async function getAsaasConfig() {
  const stored = await readIntegrationKey("asaas");
  if (stored) return { apiKey: stored.apiKey, baseUrl: asaasBaseUrl(stored.environment) };
  if (!(await currentTenant()).legacy) return null;
  const apiKey = process.env.ASAAS_API_KEY;
  const baseUrl = process.env.ASAAS_BASE_URL ?? "https://api-sandbox.asaas.com/v3";
  if (!apiKey) return null;
  return { apiKey, baseUrl };
}

export async function asaasRequest<T>(path: string, options: AsaasRequestOptions = {}): Promise<T> {
  const config = await getAsaasConfig();
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
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
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
  refunds?: Array<{ status?: string | null; dateCreated?: string | null }> | null;
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
 * Lists payments across the WHOLE Asaas account (not scoped to one link).
 *
 * This exists instead of a per-link `?paymentLink=` call because that query
 * param turned out to be a no-op on Asaas's side — confirmed empirically: a
 * real link id, a nonexistent one, and no filter at all every returned the
 * exact same `totalCount` for this account. So a loop that called this once
 * per payment link was actually re-walking the account's *entire* payment
 * history once per link (241 links × ~4,000 payments here) — the real
 * reason a manual sync could take hours instead of minutes. Each payment
 * object *does* carry its own correct `paymentLink` id though, which is how
 * `syncAsaasPayment` (lib/payment-sync.ts) routes it to the right record —
 * so one global, paginated walk covers every link in a single pass.
 *
 * `since` (ISO date, e.g. "2026-08-01") filters to payments created on/after
 * that date via `dateCreated[ge]`, so a repeat sync only walks what's new
 * since the last run instead of the full history again. Omit for a full
 * historical backfill (first-ever sync).
 */
export function listAsaasPayments(offset = 0, since?: string) {
  return asaasRequest<{ data: AsaasPayment[]; hasMore: boolean; totalCount: number }>("/payments", {
    query: { limit: "100", offset: String(offset), "dateCreated[ge]": since },
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
