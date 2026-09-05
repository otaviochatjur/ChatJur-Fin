// Gate that only lets a customer be *created* in our CRM if they already
// exist as a row in the "⭐ Base de Clientes" tab of the company's Google
// Sheet. The sheet stays private; we read it through an n8n webhook that
// already holds a Google OAuth2 credential with access to it (see
// FIN-SisFin-Otavio workflow — Webhook -> Get row(s) in sheet -> Respond to
// Webhook), so nothing here talks to Google directly.
//
// This is intentionally "fail-open if unconfigured, fail-closed if
// misbehaving": if CLIENTS_SHEET_WEBHOOK_URL isn't set at all, the gate is
// considered disabled and every customer is allowed (so this feature is
// opt-in and a missing env var never silently locks out every signup). Once
// configured, a webhook that's down/erroring means "can't verify" and we
// treat that as *not* allowed rather than letting unverified customers in,
// falling back to the last known-good list if we have one cached.

type SheetRow = Record<string, unknown>;

const TTL_MS = 5 * 60 * 1000; // 5 minutes — cheap to keep fresh without hammering n8n/Sheets on every webhook delivery.
const HEADER_NAME = "sisfin-auth";

let cache: { emails: Set<string>; fetchedAt: number } | null = null;

function normalizeEmail(email: unknown): string | null {
  const trimmed = typeof email === "string" ? email.trim().toLowerCase() : "";
  return trimmed.length > 0 ? trimmed : null;
}

async function fetchAllowlist(): Promise<Set<string>> {
  const url = process.env.CLIENTS_SHEET_WEBHOOK_URL;
  if (!url) return new Set();

  const authValue = process.env.CLIENTS_SHEET_WEBHOOK_AUTH;
  const response = await fetch(url, {
    headers: authValue ? { [HEADER_NAME]: authValue } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Base de Clientes webhook -> ${response.status}`);
  }
  const rows = (await response.json()) as SheetRow[];
  if (!Array.isArray(rows)) {
    throw new Error("Base de Clientes webhook did not return an array");
  }

  const emails = new Set<string>();
  for (const row of rows) {
    const email = normalizeEmail(row.Email);
    if (email) emails.add(email);
  }
  return emails;
}

async function getAllowlist(): Promise<Set<string> | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache.emails;

  try {
    const emails = await fetchAllowlist();
    cache = { emails, fetchedAt: now };
    return emails;
  } catch (error) {
    console.error("[clients-allowlist] failed to refresh Base de Clientes sheet:", error);
    // Serve a stale-but-known list rather than nothing, if we have one.
    return cache?.emails ?? null;
  }
}

/**
 * Whether `email` may be used to create a *new* customer record. Returns
 * true unconditionally if the gate isn't configured (no
 * CLIENTS_SHEET_WEBHOOK_URL). Existing customers already in our database are
 * never re-checked against this — it only guards first-time creation.
 */
export async function isEmailInClientsSheet(email: string | null | undefined): Promise<boolean> {
  if (!process.env.CLIENTS_SHEET_WEBHOOK_URL) return true; // gate disabled

  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const allowlist = await getAllowlist();
  if (!allowlist) return false; // couldn't verify (webhook down, no cache) — fail closed
  return allowlist.has(normalized);
}
