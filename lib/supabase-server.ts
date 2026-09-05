type SupabaseRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  prefer?: string;
};

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

  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method: options.method ?? "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(options.prefer ? { Prefer: options.prefer } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
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
