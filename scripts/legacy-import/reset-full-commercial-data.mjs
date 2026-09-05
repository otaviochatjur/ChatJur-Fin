// Full reset of the commercial/financial pipeline (Planos, Links de
// pagamento, Assinaturas, Pagamentos e Clientes) so it can be rebuilt from
// scratch using the real Asaas *production* account, once ASAAS_API_KEY /
// ASAAS_BASE_URL in .env point to production instead of the sandbox.
//
// Deliberately does NOT touch:
//   - commercial_actors (Parceiros/Embaixadores/Comercial/Institucional —
//     took a lot of manual setup: banking data, tiers, commission rates)
//   - actor_custom_plans, actor_commission_rates (default/custom-plan rates)
//   - actor_payouts (history of repasses already paid out for real)
//   - connect_leads, audit_events (Connect funnel + general audit trail)
//
// actor_commission_rates rows scoped to a specific plan_id are deleted too
// (that FK would otherwise block deleting `plans`) — the actor's
// default/custom-plan rates are untouched, only the *per official-plan*
// overrides, which need to be re-entered against the new plan IDs anyway.
//
// A full backup of every touched table is written to
// scripts/legacy-import/data/_backup_before_full_reset_<timestamp>.json
// before anything is deleted.
//
// Run: node scripts/legacy-import/reset-full-commercial-data.mjs
// Add --yes to skip the confirmation prompt (e.g. for non-interactive use).

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(__dirname, "data");

function loadEnv() {
  const raw = readFileSync(path.join(ROOT, ".env"), "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    value = value.replace(/^\\\$/, "$");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados em .env"); process.exit(1); }

async function sb(urlPath, { method = "GET", body, prefer } = {}) {
  const response = await fetch(`${SUPABASE_URL}${urlPath}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${urlPath} -> ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function confirm() {
  if (process.argv.includes("--yes")) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(
    "Isso vai APAGAR PERMANENTEMENTE todos os Planos, Links de pagamento, Assinaturas, Pagamentos e Clientes\n" +
    "(Parceiros/Embaixadores/Comercial e o histórico de repasses já pagos são preservados).\n" +
    "Um backup em JSON é salvo antes de apagar. Digite APAGAR para confirmar: ",
    resolve,
  ));
  rl.close();
  return answer.trim() === "APAGAR";
}

async function backup() {
  console.log("Fazendo backup das tabelas antes de apagar...");
  const [customers, subscriptions, payments, paymentLinks, plans, priceVersions, attributions, commissionRates] = await Promise.all([
    sb("/rest/v1/customers?select=*"),
    sb("/rest/v1/subscriptions?select=*"),
    sb("/rest/v1/payments?select=*"),
    sb("/rest/v1/payment_links?select=*"),
    sb("/rest/v1/plans?select=*"),
    sb("/rest/v1/actor_price_versions?select=*").catch(() => []),
    sb("/rest/v1/customer_attributions?select=*").catch(() => []),
    sb("/rest/v1/actor_commission_rates?select=*&plan_id=not.is.null").catch(() => []),
  ]);
  mkdirSync(DATA_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(DATA_DIR, `_backup_before_full_reset_${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ customers, subscriptions, payments, paymentLinks, plans, priceVersions, attributions, commissionRates }, null, 2));
  console.log(
    `Backup salvo em ${backupPath} ` +
    `(customers: ${customers.length}, subscriptions: ${subscriptions.length}, payments: ${payments.length}, ` +
    `payment_links: ${paymentLinks.length}, plans: ${plans.length}, price_versions: ${priceVersions.length}, ` +
    `attributions: ${attributions.length}, plan-scoped commission_rates: ${commissionRates.length})`,
  );
  return backupPath;
}

async function wipe() {
  console.log("Apagando na ordem correta de dependências...");
  await sb("/rest/v1/payments?id=not.is.null", { method: "DELETE" });
  console.log("  payments apagados.");
  await sb("/rest/v1/customer_attributions?id=not.is.null", { method: "DELETE" }).catch(() => {});
  console.log("  customer_attributions apagados.");
  await sb("/rest/v1/actor_commission_rates?plan_id=not.is.null", { method: "DELETE" }).catch(() => {});
  console.log("  actor_commission_rates (por plano) apagados.");
  await sb("/rest/v1/subscriptions?id=not.is.null", { method: "DELETE" });
  console.log("  subscriptions apagadas.");
  await sb("/rest/v1/payment_links?id=not.is.null", { method: "DELETE" });
  console.log("  payment_links apagados.");
  await sb("/rest/v1/actor_price_versions?id=not.is.null", { method: "DELETE" }).catch(() => {});
  console.log("  actor_price_versions apagadas.");
  await sb("/rest/v1/customers?id=not.is.null", { method: "DELETE" });
  console.log("  customers apagados.");
  await sb("/rest/v1/plans?id=not.is.null", { method: "DELETE" });
  console.log("  plans apagados.");
  await sb("/rest/v1/asaas_webhook_events?id=not.is.null", { method: "DELETE" }).catch(() => {});
  console.log("  asaas_webhook_events (log de idempotência) apagados.");
}

async function main() {
  const ok = await confirm();
  if (!ok) { console.log("Cancelado."); return; }
  await backup();
  await wipe();
  console.log("\nBase comercial zerada. Próximos passos:");
  console.log("1. Confirme ASAAS_API_KEY / ASAAS_BASE_URL em .env apontando para produção.");
  console.log("2. Vá em Planos e Links e cadastre os planos reais.");
  console.log("3. Clique em 'Sincronizar links do Asaas' para trazer os links já existentes na conta.");
  console.log("4. Vincule cada link a um parceiro/ator e a um plano.");
  console.log("5. Use 'Sincronizar pagamentos' em Clientes para trazer as assinaturas/pagamentos reais.");
}

main().catch((error) => { console.error(error); process.exit(1); });
