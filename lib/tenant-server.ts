import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { requireUser } from "./auth-server";

export type Tenant = { id: string; owner_user_id: string | null; reserved_email: string | null; legacy: boolean };
const webhookContext = new AsyncLocalStorage<Tenant>();

/** Privileged access is restricted to identity/configuration lookups, never browser-supplied paths. */
export async function adminRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.SUPABASE_URL;
  if (!key || !url) throw new Error("Servidor não configurado.");
  const response = await fetch(`${url}${path}`, {
    method: options.method ?? "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Não foi possível acessar a configuração da conta.");
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const currentTenant = cache(async (): Promise<Tenant> => {
  const webhook = webhookContext.getStore();
  if (webhook) return webhook;
  const { user } = await requireUser();
  const rows = await adminRequest<Tenant[]>(`/rest/v1/nexo_tenants?owner_user_id=eq.${encodeURIComponent(user.id)}&select=*`);
  if (rows[0]) return rows[0];
  // A reserved base can only be claimed by its verified email, once.
  const reserved = await adminRequest<Tenant[]>(`/rest/v1/nexo_tenants?reserved_email=eq.${encodeURIComponent(user.email.toLowerCase())}&owner_user_id=is.null&select=*`);
  if (reserved[0]) {
    const claimed = await adminRequest<Tenant[]>(`/rest/v1/nexo_tenants?id=eq.${reserved[0].id}&owner_user_id=is.null`, { method: "PATCH", body: { owner_user_id: user.id } });
    if (claimed[0]) return claimed[0];
  }
  try {
    const [created] = await adminRequest<Tenant[]>("/rest/v1/nexo_tenants", { method: "POST", body: { owner_user_id: user.id } });
    return created;
  } catch {
    const existing = await adminRequest<Tenant[]>(`/rest/v1/nexo_tenants?owner_user_id=eq.${encodeURIComponent(user.id)}&select=*`);
    if (!existing[0]) throw new Error("Não foi possível preparar sua conta.");
    return existing[0];
  }
});

export function withWebhookTenant<T>(tenant: Tenant, action: () => Promise<T>) { return webhookContext.run(tenant, action); }
export function isWebhookRequest() { return Boolean(webhookContext.getStore()); }
