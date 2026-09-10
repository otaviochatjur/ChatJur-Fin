import { currentTenant, isWebhookRequest } from "./tenant-server";
import { requireUser } from "./auth-server";
type SupabaseRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  prefer?: string;
};

/** Only the fixed synchronization function is exposed; tenant identity comes from the session. */
export async function finishAsaasBaseSync<T>(generation: string, offset: number): Promise<T> {
  const tenant = await currentTenant();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !process.env.SUPABASE_URL) throw new Error("Supabase não configurado.");
  const token = isWebhookRequest() ? key : (await requireUser()).accessToken;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/finish_asaas_base_sync`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_tenant: tenant.id, p_generation: generation, p_offset: offset }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Não foi possível concluir a sincronização.");
  return data as T;
}

/** Atomically moves every customer-owned relationship before deleting duplicate rows. */
export async function mergeCustomerRecords<T>(keepId: string, mergeIds: string[]): Promise<T> {
  const tenant = await currentTenant();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !process.env.SUPABASE_URL) throw new Error("Supabase não configurado.");
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/merge_customer_records`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_tenant: tenant.id, p_keep: keepId, p_merge: mergeIds }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Não foi possível consolidar os cadastros duplicados.");
  return data as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Right after a migration, Supabase's PostgREST schema cache can take a
 * while to propagate across edge nodes — some requests 404 on a table that
 * demonstrably exists (confirmed in the Table Editor) while others succeed,
 * for a minute or more. Retrying a few times with backoff smooths over that
 * window instead of surfacing a spurious "table not found" to the UI.
 */
async function isSchemaCacheMiss(response: Response, data: unknown) {
  if (response.status !== 404) return false;
  const message = typeof (data as { message?: string })?.message === "string" ? (data as { message: string }).message : "";
  return /schema cache/i.test(message) || message === "";
}

export async function supabaseRequest<T>(path: string, options: SupabaseRequestOptions = {}): Promise<T> {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase não configurado no servidor.");

  const tenant = await currentTenant();
  const scopedUrl = new URL(path, url);
  if (scopedUrl.origin !== new URL(url).origin || !scopedUrl.pathname.startsWith("/rest/v1/")) throw new Error("Consulta inválida.");
  scopedUrl.searchParams.set("tenant_id", "eq." + tenant.id);
  const token = isWebhookRequest() ? serviceRoleKey : (await requireUser()).accessToken;
  const scopedBody = options.body === undefined ? undefined : Array.isArray(options.body)
    ? options.body.map(row => ({ ...row, tenant_id: tenant.id }))
    : { ...(options.body as Record<string, unknown>), tenant_id: tenant.id };
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(scopedUrl, {
      method: options.method ?? "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.prefer ? { Prefer: options.prefer } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(scopedBody) }),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (response.ok) return data as T;

    if (attempt < maxAttempts && (await isSchemaCacheMiss(response, data))) {
      await sleep(attempt * 1500);
      continue;
    }
    throw new Error(data?.message ?? data?.error ?? `Supabase respondeu ${response.status}.`);
  }
  throw new Error("Supabase respondeu 404 de forma persistente (schema cache).");
}
