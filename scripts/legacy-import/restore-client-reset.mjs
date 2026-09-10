import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator < 1) continue;
  const envKey = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^\\\$/, "$" );
  process.env[envKey] ??= value;
}
const backupArg = process.argv.find(arg => arg.startsWith("--backup="));
if (!backupArg) throw new Error("Informe --backup=<arquivo>.");
const backupPath = path.resolve(backupArg.slice(9));
const serialized = readFileSync(backupPath, "utf8");
const expectedHash = readFileSync(`${backupPath}.sha256`, "utf8").trim().split(/\s+/)[0];
const actualHash = createHash("sha256").update(serialized).digest("hex");
if (actualHash !== expectedHash) throw new Error("O backup falhou na verificação SHA-256.");
const backup = JSON.parse(serialized);
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase não configurado.");
const tenantId = backup.tenant.id;
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function db(pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, { method: options.method ?? "GET", headers: { ...headers, ...(options.prefer ? { Prefer: options.prefer } : {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${pathname} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}
async function all(table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db(`/rest/v1/${table}?tenant_id=eq.${tenantId}&select=*&order=created_at.asc&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
async function insertBatches(table, rows, prefer = "return=minimal") {
  for (let offset = 0; offset < rows.length; offset += 100) {
    await db(`/rest/v1/${table}`, { method: "POST", prefer, body: rows.slice(offset, offset + 100) });
  }
}
const email = value => value?.trim().toLowerCase() ?? "";

const vite = await createServer({ appType: "custom", cacheDir: "node_modules/.vite-client-reset", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let sheetResult;
try {
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const { syncClientsFromSheet } = await vite.ssrLoadModule("/lib/client-sheet-sync.ts");
  sheetResult = await withWebhookTenant(backup.tenant, () => syncClientsFromSheet());
} finally {
  await vite.close();
}
if (sheetResult.created !== 755 || sheetResult.skippedWithoutSignedAt.length || sheetResult.unresolvedRows.length || sheetResult.officeIdConflicts.length || sheetResult.duplicateOfficeIds.length) {
  throw new Error(`Importação da Base não ficou íntegra: ${JSON.stringify(sheetResult)}`);
}

const newCustomers = await all("customers");
const newByOffice = new Map(newCustomers.filter(row => row.external_office_id).map(row => [row.external_office_id, row]));
const newByEmail = new Map();
for (const row of newCustomers) {
  const matches = newByEmail.get(email(row.email)) ?? [];
  matches.push(row);
  newByEmail.set(email(row.email), matches);
}
const oldToNew = new Map();
for (const old of backup.customers) {
  let target = old.external_office_id ? newByOffice.get(old.external_office_id) : null;
  const emailMatches = newByEmail.get(email(old.email)) ?? [];
  if (!target && emailMatches.length === 1) target = emailMatches[0];
  if (!target && emailMatches.length > 1) {
    const name = old.office_name?.trim().toLowerCase();
    const named = emailMatches.filter(row => row.office_name?.trim().toLowerCase() === name);
    if (named.length === 1) target = named[0];
  }
  if (target) oldToNew.set(old.id, target.id);
}
const relationCustomerIds = new Set([...backup.subscriptions, ...backup.payments, ...backup.implementationPayments, ...backup.aliases].map(row => row.customer_id).filter(Boolean));
const unmappedRelations = [...relationCustomerIds].filter(id => !oldToNew.has(id));
if (unmappedRelations.length) throw new Error(`${unmappedRelations.length} cliente(s) com vínculos não puderam ser relacionados à nova Base.`);

const subscriptionCount = new Map(), paymentCount = new Map(), implementationCount = new Map();
for (const row of backup.subscriptions) subscriptionCount.set(row.customer_id, (subscriptionCount.get(row.customer_id) ?? 0) + 1);
for (const row of backup.payments) paymentCount.set(row.customer_id, (paymentCount.get(row.customer_id) ?? 0) + 1);
for (const row of backup.implementationPayments) implementationCount.set(row.customer_id, (implementationCount.get(row.customer_id) ?? 0) + 1);
const oldGroups = new Map();
for (const old of backup.customers) {
  const newId = oldToNew.get(old.id);
  if (!newId) continue;
  const rows = oldGroups.get(newId) ?? [];
  rows.push(old);
  oldGroups.set(newId, rows);
}
const chosenPrimary = new Map();
const restoredCustomers = newCustomers.map(current => {
  const candidates = oldGroups.get(current.id) ?? [];
  const exact = candidates.find(row => row.external_office_id && row.external_office_id === current.external_office_id);
  const ranked = [...candidates].sort((a, b) => ((paymentCount.get(b.id) ?? 0) + (subscriptionCount.get(b.id) ?? 0) + (implementationCount.get(b.id) ?? 0)) - ((paymentCount.get(a.id) ?? 0) + (subscriptionCount.get(a.id) ?? 0) + (implementationCount.get(a.id) ?? 0)));
  const source = exact ?? ranked[0];
  const primary = source?.asaas_customer_id ?? candidates.find(row => row.asaas_customer_id)?.asaas_customer_id ?? null;
  chosenPrimary.set(current.id, primary);
  const statuses = new Set(candidates.map(row => row.status).filter(Boolean));
  const status = statuses.size === 1 ? [...statuses][0] : statuses.has("CANCELLED") ? "CANCELLED" : statuses.has("FROZEN") ? "FROZEN" : "ACTIVE";
  return {
    ...current,
    asaas_customer_id: primary,
    status,
    acquisition_actor_id: source?.acquisition_actor_id ?? candidates.find(row => row.acquisition_actor_id)?.acquisition_actor_id ?? current.acquisition_actor_id,
    onboarding_completed: candidates.some(row => row.onboarding_completed) || current.onboarding_completed,
    api_oficial: candidates.some(row => row.api_oficial) || current.api_oficial,
    cancelled_at: source?.cancelled_at ?? candidates.find(row => row.cancelled_at)?.cancelled_at ?? current.cancelled_at,
    cancellation_category: source?.cancellation_category ?? candidates.find(row => row.cancellation_category)?.cancellation_category ?? current.cancellation_category,
    cancellation_reason: source?.cancellation_reason ?? candidates.find(row => row.cancellation_reason)?.cancellation_reason ?? current.cancellation_reason,
    comments: source?.comments ?? candidates.find(row => row.comments)?.comments ?? current.comments,
  };
});
await insertBatches("customers?on_conflict=tenant_id,id", restoredCustomers, "resolution=merge-duplicates,return=minimal");

const aliasByAsaas = new Map();
for (const alias of backup.aliases) {
  const customerId = oldToNew.get(alias.customer_id);
  if (customerId) aliasByAsaas.set(alias.asaas_customer_id, { ...alias, customer_id: customerId, is_primary: chosenPrimary.get(customerId) === alias.asaas_customer_id });
}
for (const old of backup.customers) {
  const customerId = oldToNew.get(old.id);
  if (customerId && old.asaas_customer_id && !aliasByAsaas.has(old.asaas_customer_id)) aliasByAsaas.set(old.asaas_customer_id, { tenant_id: tenantId, customer_id: customerId, asaas_customer_id: old.asaas_customer_id, is_primary: chosenPrimary.get(customerId) === old.asaas_customer_id, created_at: new Date().toISOString() });
}
await insertBatches("customer_asaas_aliases", [...aliasByAsaas.values()]);

await insertBatches("subscriptions", backup.subscriptions.map(row => ({ ...row, customer_id: oldToNew.get(row.customer_id) })));
await insertBatches("payments", backup.payments.map(row => ({ ...row, customer_id: row.customer_id ? oldToNew.get(row.customer_id) : null })));
await insertBatches("implementation_payments", backup.implementationPayments.map(row => ({ ...row, customer_id: row.customer_id ? oldToNew.get(row.customer_id) : null })));

const remapJson = value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = { ...value };
  if (typeof copy.customerId === "string" && oldToNew.has(copy.customerId)) copy.customerId = oldToNew.get(copy.customerId);
  if (typeof copy.id === "string" && oldToNew.has(copy.id)) copy.id = oldToNew.get(copy.id);
  return copy;
};
await insertBatches("audit_events", backup.customerAudit.map(row => ({ ...row, entity_id: row.entity_type === "customer" && oldToNew.has(row.entity_id) ? oldToNew.get(row.entity_id) : row.entity_id, before_json: remapJson(row.before_json), after_json: remapJson(row.after_json) })));

const finalCounts = { customers: (await all("customers")).length, subscriptions: (await all("subscriptions")).length, payments: (await all("payments")).length, implementationPayments: (await all("implementation_payments")).length, aliases: (await all("customer_asaas_aliases")).length };
console.log(JSON.stringify({ sheetResult, mappedOldCustomers: oldToNew.size, finalCounts }, null, 2));
