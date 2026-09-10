import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator < 1) continue;
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^\\\$/, "$" );
  process.env[key] ??= value;
}
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase não configurado.");
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const ownerEmail = "otavio@chatjuridico.com.br";

async function get(pathname) {
  const response = await fetch(`${url}${pathname}`, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}
async function all(table, tenantId, extra = "") {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await get(`/rest/v1/${table}?tenant_id=eq.${tenantId}&select=*${extra}&order=created_at.asc&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const [tenant] = await get(`/rest/v1/nexo_tenants?reserved_email=eq.${encodeURIComponent(ownerEmail)}&select=id,reserved_email,legacy&limit=1`);
if (!tenant) throw new Error("Conta principal não encontrada.");
const [customers, subscriptions, payments, implementationPayments, aliases, customerAudit] = await Promise.all([
  all("customers", tenant.id),
  all("subscriptions", tenant.id),
  all("payments", tenant.id),
  all("implementation_payments", tenant.id),
  all("customer_asaas_aliases", tenant.id),
  all("audit_events", tenant.id, "&entity_type=in.(customer,customer_activity)"),
]);
const backup = { createdAt: new Date().toISOString(), tenant, customers, subscriptions, payments, implementationPayments, aliases, customerAudit };
const serialized = JSON.stringify(backup, null, 2);
const digest = createHash("sha256").update(serialized).digest("hex");
const directory = path.join(root, "scripts", "legacy-import", "data");
mkdirSync(directory, { recursive: true });
const stamp = backup.createdAt.replace(/[:.]/g, "-");
const file = path.join(directory, `_backup_client_reset_${stamp}.json`);
writeFileSync(file, serialized);
writeFileSync(`${file}.sha256`, `${digest}  ${path.basename(file)}\n`);
console.log(JSON.stringify({ file, sha256: digest, counts: { customers: customers.length, subscriptions: subscriptions.length, payments: payments.length, implementationPayments: implementationPayments.length, aliases: aliases.length, customerAudit: customerAudit.length } }, null, 2));
