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
  const value = trimmed.slice(separator + 1).trim().replace(/^\\\$/, "$");
  process.env[envKey] ??= value;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase não configurado em .env.");

const ownerEmail = process.argv.find((arg) => arg.startsWith("--email="))?.slice(8) ?? "otavio@chatjuridico.com.br";
const targetEmail = process.argv.find((arg) => arg.startsWith("--customer-email="))?.slice(17)?.trim().toLowerCase() ?? null;
const apply = process.argv.includes("--apply");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function db(pathname) {
  const response = await fetch(`${url}${pathname}`, { headers });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`GET ${pathname} -> ${response.status}: ${responseText}`);
  return responseText ? JSON.parse(responseText) : [];
}

async function dbAll(pathname, order = "created_at.asc") {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const separator = pathname.includes("?") ? "&" : "?";
    const page = await db(`${pathname}${separator}order=${order}&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const [tenant] = await db(`/rest/v1/nexo_tenants?reserved_email=eq.${encodeURIComponent(ownerEmail)}&select=id,owner_user_id,reserved_email,legacy&limit=1`);
if (!tenant) throw new Error(`Conta não encontrada para ${ownerEmail}.`);

const [state] = await db(`/rest/v1/asaas_base_sync?tenant_id=eq.${tenant.id}&select=active_generation,status,completed_at&limit=1`);
if (!state?.active_generation) throw new Error("A Base do Asaas ainda não possui uma geração concluída.");

const [objects, aliases, customers, savedPayments, savedImplementationPayments] = await Promise.all([
  dbAll(`/rest/v1/asaas_base_objects?tenant_id=eq.${tenant.id}&generation=eq.${state.active_generation}&kind=eq.PAYMENT&select=external_id,payload`, "external_id.asc"),
  dbAll(`/rest/v1/customer_asaas_aliases?tenant_id=eq.${tenant.id}&select=asaas_customer_id,customer_id`, "asaas_customer_id.asc"),
  dbAll(`/rest/v1/customers?tenant_id=eq.${tenant.id}&select=id,email,office_name`, "id.asc"),
  dbAll(`/rest/v1/payments?tenant_id=eq.${tenant.id}&select=asaas_payment_id`, "asaas_payment_id.asc"),
  dbAll(`/rest/v1/implementation_payments?tenant_id=eq.${tenant.id}&asaas_payment_id=not.is.null&select=asaas_payment_id`, "asaas_payment_id.asc"),
]);

const customerById = new Map(customers.map((customer) => [customer.id, customer]));
const customerIdByAsaas = new Map(aliases.map((alias) => [alias.asaas_customer_id, alias.customer_id]));
const savedIds = new Set([...savedPayments, ...savedImplementationPayments].map((payment) => payment.asaas_payment_id));
const eligible = objects.filter(({ external_id: id, payload }) => {
  if (savedIds.has(id) || !customerIdByAsaas.has(payload?.customer)) return false;
  if (!targetEmail) return true;
  return customerById.get(customerIdByAsaas.get(payload.customer))?.email?.trim().toLowerCase() === targetEmail;
});

const preview = {
  mode: apply ? "applied" : "preview",
  sourceGeneration: state.active_generation,
  baseStatus: state.status,
  basePayments: objects.length,
  savedPayments: savedIds.size,
  eligibleMissingPayments: eligible.length,
  targetEmail,
};

if (!apply || eligible.length === 0) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const vite = await createServer({
  appType: "custom",
  cacheDir: "node_modules/.vite-missing-asaas-payments",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

const outcomes = { created: 0, updated: 0, skipped: 0, failed: 0 };
const failures = [];
try {
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const { syncAsaasPayment } = await vite.ssrLoadModule("/lib/payment-sync.ts");
  for (const object of eligible) {
    try {
      const outcome = await withWebhookTenant(tenant, () => syncAsaasPayment(object.payload));
      outcomes[outcome.result] += 1;
    } catch (error) {
      outcomes.failed += 1;
      failures.push({ paymentId: object.external_id, error: error instanceof Error ? error.message : String(error) });
    }
  }
} finally {
  await vite.close();
}

console.log(JSON.stringify({ ...preview, outcomes, failures }, null, 2));
if (failures.length) process.exitCode = 1;
