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
// The sheet owns intake/contact fields. Operational fields (status, plans,
// subscriptions, payments and activity) remain owned by this application.

const TTL_MS = 5 * 60 * 1000; // 5 minutes — cheap to keep fresh without hammering n8n/Sheets on every webhook delivery.
const HEADER_NAME = "sisfin-auth";

export type ClientSheetRow = {
  email: string;
  officeId: string | null;
  officeName: string | null;
  responsibleName: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  serviceArea: string | null;
  sourceChannel: string | null;
  signedAt: string | null;
};

type RawRow = Record<string, unknown>;

type SheetRows = { byEmail: Map<string, ClientSheetRow>; duplicateEmails: string[]; ignoredWithoutEmail: number };

let cache: (SheetRows & { fetchedAt: number }) | null = null;

function clean(value: unknown): string | null {
  const trimmed = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(email: unknown): string | null {
  const trimmed = typeof email === "string" ? email.trim().toLowerCase() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function first(row: RawRow, keys: string[]): unknown {
  for (const key of keys) if (clean(row[key]) !== null) return row[key];
  return null;
}

export function parseClientSheetDate(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/.exec(raw);
  const parts = br ? [br[3], br[2], br[1]] : iso ? [iso[1], iso[2], iso[3]] : null;
  if (!parts) return null;
  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseRow(row: RawRow): ClientSheetRow | null {
  const email = normalizeEmail(row.Email);
  if (!email) return null;
  return {
    email,
    officeId: clean(first(row, ["office_id", "Número do cliente", "Número do Cliente", "Numero do cliente", "Nº do cliente"])),
    officeName: clean(first(row, ["Nome do Escritório", "Nome do Escritorio"])),
    responsibleName: clean(first(row, ["Nome do Responsável", "Nome do Responsavel"])),
    phone: clean(first(row, ["Whatsapp Responsável", "WhatsApp Responsável", "Whatsapp Responsavel"])),
    city: clean(row.Cidade),
    state: clean(row.Estado),
    serviceArea: clean(first(row, ["Área de Atendimento", "Area de Atendimento"])),
    sourceChannel: clean(row["Veio de"]) ?? clean(row.Parceiro),
    signedAt: parseClientSheetDate(first(row, ["Assinado em", "Data de assinatura"])),
  };
}

function hasClientData(row: RawRow) {
  return [row.Email, row.office_id, row["Número do cliente"], row["Número do Cliente"], row["Nome do Escritório"], row["Nome do Responsável"], row["Assinado em"]]
    .some(value => clean(value) !== null);
}

async function fetchSheetRows(): Promise<SheetRows> {
  const url = process.env.CLIENTS_SHEET_WEBHOOK_URL;
  if (!url) return { byEmail: new Map(), duplicateEmails: [], ignoredWithoutEmail: 0 };

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
  const duplicateEmails = new Set<string>();
  let ignoredWithoutEmail = 0;
  for (const raw of rows) {
    const row = parseRow(raw);
    if (!row) { if (hasClientData(raw)) ignoredWithoutEmail += 1; continue; }
    if (byEmail.has(row.email)) duplicateEmails.add(row.email);
    else byEmail.set(row.email, row);
  }
  for (const email of duplicateEmails) byEmail.delete(email);
  return { byEmail, duplicateEmails: [...duplicateEmails].sort(), ignoredWithoutEmail };
}

async function getSheetRows(fresh = false): Promise<SheetRows | null> {
  const now = Date.now();
  if (!fresh && cache && now - cache.fetchedAt < TTL_MS) return cache;

  try {
    const rows = await fetchSheetRows();
    cache = { ...rows, fetchedAt: now };
    return rows;
  } catch (error) {
    console.error("[clients-allowlist] failed to refresh Base de Clientes sheet:", error);
    // Serve a stale-but-known list rather than nothing, if we have one.
    return cache ?? null;
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
  return rows.byEmail.has(normalized);
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
  return rows.byEmail.get(normalized) ?? null;
}

/** Returns a fresh, de-duplicated snapshot for the explicit reconciliation flow. */
export async function listClientsInSheet(): Promise<SheetRows> {
  if (!process.env.CLIENTS_SHEET_WEBHOOK_URL) throw new Error("Integração com a Base de Clientes não configurada.");
  const rows = await getSheetRows(true);
  if (!rows) throw new Error("Não foi possível consultar a Base de Clientes.");
  return rows;
}
