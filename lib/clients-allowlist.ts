// Gate + lookup for the "⭐ Base de Clientes" tab of the company's Google
// Sheet, which is the single manual intake point for new clients (Nome,
// Email, Telefone, OfficeId). Everything else about a client — plan,
// subscriptions, payments, status, cancellations, upsell/downsell history —
// lives only in this app from that point on. The sheet stays private; we
// read it through an n8n webhook that already holds a Google OAuth2
// credential with access to it (see FIN-SisFin-Otavio workflow — Webhook ->
// Get row(s) in sheet -> Respond to Webhook), so nothing here talks to
// Google directly.
//
// This is intentionally "fail-open if unconfigured, fail-closed if
// misbehaving": if CLIENTS_SHEET_WEBHOOK_URL isn't set at all, the gate is
// considered disabled and every customer is allowed (so this feature is
// opt-in and a missing env var never silently locks out every signup). Once
// configured, a webhook that's down/erroring means "can't verify" and we
// treat that as *not* allowed rather than letting unverified customers in,
// falling back to the last known-good list if we have one cached.
//
// Important: this module only ever *creates* new customers from the sheet.
// It is never consulted again for a customer that already exists in our
// database — once created here, the sheet can keep changing and it will
// have zero effect on that customer's record. Supabase is the source of
// truth from the moment the customer is created.

const TTL_MS = 5 * 60 * 1000; // 5 minutes — cheap to keep fresh without hammering n8n/Sheets on every webhook delivery.
const HEADER_NAME = "sisfin-auth";

export type ClientSheetRow = {
  email: string;
  officeId: string | null;
  officeName: string | null;
  responsibleName: string | null;
  phone: string | null;
};

type RawRow = Record<string, unknown>;

let cache: { byEmail: Map<string, ClientSheetRow>; fetchedAt: number } | null = null;

function clean(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(email: unknown): string | null {
  const trimmed = typeof email === "string" ? email.trim().toLowerCase() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseRow(row: RawRow): ClientSheetRow | null {
  const email = normalizeEmail(row.Email);
  if (!email) return null;
  return {
    email,
    officeId: clean(row.office_id),
    officeName: clean(row["Nome do Escritório"]),
    responsibleName: clean(row["Nome do Responsável"]),
    phone: clean(row["Whatsapp Responsável"]),
  };
}

async function fetchSheetRows(): Promise<Map<string, ClientSheetRow>> {
  const url = process.env.CLIENTS_SHEET_WEBHOOK_URL;
  if (!url) return new Map();

  const authValue = process.env.CLIENTS_SHEET_WEBHOOK_AUTH;
  const response = await fetch(url, {
    headers: authValue ? { [HEADER_NAME]: authValue } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Base de Clientes webhook -> ${response.status}`);
  }
  const rows = (await response.json()) as RawRow[];
  if (!Array.isArray(rows)) {
    throw new Error("Base de Clientes webhook did not return an array");
  }

  const byEmail = new Map<string, ClientSheetRow>();
  for (const raw of rows) {
    const row = parseRow(raw);
    if (row) byEmail.set(row.email, row);
  }
  return byEmail;
}

async function getSheetRows(): Promise<Map<string, ClientSheetRow> | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache.byEmail;

  try {
    const byEmail = await fetchSheetRows();
    cache = { byEmail, fetchedAt: now };
    return byEmail;
  } catch (error) {
    console.error("[clients-allowlist] failed to refresh Base de Clientes sheet:", error);
    // Serve a stale-but-known list rather than nothing, if we have one.
    return cache?.byEmail ?? null;
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

  const rows = await getSheetRows();
  if (!rows) return false; // couldn't verify (webhook down, no cache) — fail closed
  return rows.has(normalized);
}

/**
 * Looks up the intake row for `email` in the Base de Clientes sheet, to seed
 * a brand-new customer record (office name, responsible name, phone, office
 * id). Returns null if the gate is disabled, the email isn't found, or the
 * sheet can't be reached — callers should treat null the same as "not
 * allowed to create".
 */
export async function findClientInSheet(email: string | null | undefined): Promise<ClientSheetRow | null> {
  if (!process.env.CLIENTS_SHEET_WEBHOOK_URL) return null; // gate disabled: caller should not depend on this for data

  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const rows = await getSheetRows();
  if (!rows) return null;
  return rows.get(normalized) ?? null;
}
