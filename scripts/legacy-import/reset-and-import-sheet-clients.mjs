// Wipes customers/subscriptions/payments and rebuilds `customers` +
// `subscriptions` straight from the live "⭐ Base de Clientes" Google Sheet
// (read through the n8n webhook — see lib/clients-allowlist.ts for the same
// data source used to gate new Asaas customers).
//
// This supersedes the one-off CSV-based `run.mjs` client import: the sheet
// is the live, continuously-updated version of that same spreadsheet, so we
// throw away whatever is currently in `customers`/`subscriptions`/`payments`
// (a mix of that CSV snapshot + a handful of real/simulated Asaas syncs) and
// treat the sheet as the sole source of truth going forward.
//
// A full backup of the three tables is written to
// scripts/legacy-import/data/_backup_before_reset_<timestamp>.json before
// anything is deleted.
//
// Run: node scripts/legacy-import/reset-and-import-sheet-clients.mjs
// Safe to re-run: it always starts from a clean wipe, so re-running just
// rebuilds from whatever the sheet says right now.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
const SHEET_URL = process.env.CLIENTS_SHEET_WEBHOOK_URL;
const SHEET_AUTH = process.env.CLIENTS_SHEET_WEBHOOK_AUTH;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados em .env"); process.exit(1); }
if (!SHEET_URL) { console.error("CLIENTS_SHEET_WEBHOOK_URL não configurado em .env"); process.exit(1); }

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

function normalize(text) {
  return (text ?? "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function clean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") { const trimmed = value.trim(); return trimmed || null; }
  return value;
}

function parseDateBr(value) {
  const v = clean(value);
  if (!v) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v));
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseInstallments(value) {
  const v = clean(value);
  if (!v) return null;
  const match = /(\d+)\s*x/i.exec(String(v));
  return match ? Number(match[1]) : null;
}

function parseNumber(value) {
  const v = clean(value);
  if (v === null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseBool(value) {
  if (typeof value === "boolean") return value;
  const v = clean(value);
  if (v === null) return false;
  return String(v).trim().toUpperCase() === "TRUE";
}

const STATUS_MAP = { Ativo: "ACTIVE", Cancelado: "CANCELLED", Congelada: "FROZEN", Congelado: "FROZEN" };

function matchPlan(plansCatalog, planNameRaw, billingPeriod) {
  const normalized = normalize(planNameRaw);
  let targetName = null;
  if (["ia100", "ia100v2", "crmia"].includes(normalized)) targetName = "CRM + IA";
  else if (normalized.startsWith("ia") && normalized.includes("aniversario")) targetName = "CRM + IA Plus";
  else if (normalized === "ia" || normalized === "iaplus" || normalized === "ia+") targetName = "CRM + IA Plus";
  if (!targetName) return null;
  return plansCatalog.find((plan) => normalize(plan.name) === normalize(targetName) && plan.billing_period === billingPeriod)?.id ?? null;
}

function fuzzyFindActor(actorIndex, name) {
  const target = normalize(name);
  if (!target) return null;
  return actorIndex.find((actor) => {
    const known = normalize(actor.name);
    return known === target || known.includes(target) || target.includes(known);
  }) ?? null;
}

async function fetchSheetRows() {
  const response = await fetch(SHEET_URL, { headers: SHEET_AUTH ? { "sisfin-auth": SHEET_AUTH } : undefined });
  if (!response.ok) throw new Error(`Base de Clientes webhook -> ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Base de Clientes webhook não retornou um array");
  return rows;
}

function parseSheetRow(row) {
  const statusRaw = clean(row.STATUS);
  const status = statusRaw ? STATUS_MAP[statusRaw] : null;
  if (!status) return null; // filler/blank row, or unrecognized status — skip like prepare.py did

  const periodRaw = clean(row["Período"]);
  const billingPeriod = periodRaw === "ANUAL" ? "ANNUAL" : "MONTHLY";
  const mrr = parseNumber(row.MRR) ?? 0;
  const value = billingPeriod === "ANNUAL" ? Math.round(mrr * 12 * 100) / 100 : Math.round(mrr * 100) / 100;

  return {
    external_office_id: clean(row.office_id),
    office_name: clean(row["Nome do Escritório"]) || "Sem nome",
    responsible_name: clean(row["Nome do Responsável"]),
    email: clean(row.Email),
    phone: clean(row["Whatsapp Responsável"]),
    city: clean(row.Cidade),
    state: clean(row.Estado),
    service_area: clean(row["Área de Atendimento"]),
    status,
    onboarding_completed: parseBool(row.Onboarding),
    source_channel: clean(row["Veio de"]) || clean(row.Parceiro),
    api_oficial: (clean(row["API Oficial"]) || "").toString().toUpperCase() === "SIM",
    signed_at: parseDateBr(row["Assinado em"]),
    cancelled_at: parseDateBr(row["Cancelado em"]),
    cancellation_category: clean(row["Categoria do Cancelamento"]),
    cancellation_reason: clean(row["Motivo do Cancelamento"]),
    comments: clean(row["Comentários"]),
    implementation_date: parseDateBr(row["Data Implantacao"]),
    implementation_value: parseNumber(row["Valor Implantacao"]),
    plan_name_raw: clean(row.Plano),
    billing_period: billingPeriod,
    value,
    payment_method: clean(row.Pagamento),
    installments: parseInstallments(row.Parcelas),
  };
}

async function backupCurrentData() {
  console.log("Fazendo backup das tabelas atuais antes de apagar...");
  const [customers, subscriptions, payments, attributions] = await Promise.all([
    sb("/rest/v1/customers?select=*"),
    sb("/rest/v1/subscriptions?select=*"),
    sb("/rest/v1/payments?select=*"),
    sb("/rest/v1/customer_attributions?select=*").catch(() => []),
  ]);
  mkdirSync(DATA_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(DATA_DIR, `_backup_before_reset_${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ customers, subscriptions, payments, attributions }, null, 2));
  console.log(`Backup salvo em ${backupPath} (customers: ${customers.length}, subscriptions: ${subscriptions.length}, payments: ${payments.length}, attributions: ${attributions.length})`);
  return backupPath;
}

async function wipeCustomerData() {
  console.log("Apagando payments, subscriptions, customer_attributions e customers...");
  await sb("/rest/v1/payments?id=not.is.null", { method: "DELETE" });
  await sb("/rest/v1/subscriptions?id=not.is.null", { method: "DELETE" });
  await sb("/rest/v1/customer_attributions?id=not.is.null", { method: "DELETE" }).catch(() => {});
  await sb("/rest/v1/customers?id=not.is.null", { method: "DELETE" });
  console.log("Base de clientes zerada.");
}

async function main() {
  console.log("Lendo planilha ⭐ Base de Clientes via webhook...");
  const sheetRows = await fetchSheetRows();
  console.log(`  ${sheetRows.length} linha(s) na planilha.`);

  const [actors, plansCatalog] = await Promise.all([
    sb("/rest/v1/commercial_actors?select=id,name,role"),
    sb("/rest/v1/plans?select=id,name,billing_period"),
  ]);

  await backupCurrentData();
  await wipeCustomerData();

  const report = {
    totalRows: sheetRows.length,
    skippedBlank: 0,
    created: 0,
    duplicateInSheet: 0,
    actorMatched: 0,
    actorUnmatched: new Set(),
    planMatched: 0,
    planUnmatched: new Set(),
  };

  const seenKeys = new Set(); // dedupe: external_office_id, else normalized office_name+email
  let processed = 0;
  for (const row of sheetRows) {
    const client = parseSheetRow(row);
    if (!client) { report.skippedBlank += 1; continue; }

    const dedupeKey = client.external_office_id ?? `${normalize(client.office_name)}|${normalize(client.email)}`;
    if (seenKeys.has(dedupeKey)) { report.duplicateInSheet += 1; continue; }
    seenKeys.add(dedupeKey);

    const actorMatch = client.source_channel ? fuzzyFindActor(actors, client.source_channel) : null;
    if (actorMatch) report.actorMatched += 1;
    else if (client.source_channel) report.actorUnmatched.add(client.source_channel);

    const [created] = await sb("/rest/v1/customers", {
      method: "POST",
      prefer: "return=representation",
      body: {
        external_office_id: client.external_office_id,
        office_name: client.office_name,
        responsible_name: client.responsible_name,
        email: client.email,
        phone: client.phone,
        city: client.city,
        state: client.state,
        service_area: client.service_area,
        status: client.status,
        onboarding_completed: client.onboarding_completed,
        source_channel: client.source_channel,
        acquisition_actor_id: actorMatch?.id ?? null,
        api_oficial: client.api_oficial,
        signed_at: client.signed_at,
        cancelled_at: client.cancelled_at,
        cancellation_category: client.cancellation_category,
        cancellation_reason: client.cancellation_reason,
        comments: client.comments,
        implementation_date: client.implementation_date,
        implementation_value: client.implementation_value,
      },
    });

    const planId = matchPlan(plansCatalog, client.plan_name_raw, client.billing_period);
    if (planId) report.planMatched += 1;
    else if (client.plan_name_raw) report.planUnmatched.add(client.plan_name_raw);

    await sb("/rest/v1/subscriptions", {
      method: "POST",
      body: {
        customer_id: created.id,
        plan_id: planId,
        custom_plan_id: null,
        plan_name_raw: client.plan_name_raw,
        payment_link_id: null,
        actor_id: actorMatch?.id ?? null,
        billing_period: client.billing_period,
        value: client.value,
        payment_method: client.payment_method,
        installments: client.installments,
        status: client.status,
        started_at: client.signed_at,
        cancelled_at: client.cancelled_at,
        source: "LEGACY_IMPORT",
      },
    });

    report.created += 1;
    processed += 1;
    if (processed % 100 === 0) console.log(`  ... ${processed}/${sheetRows.length} linhas processadas`);
  }

  const serializable = { ...report, actorUnmatched: Array.from(report.actorUnmatched), planUnmatched: Array.from(report.planUnmatched) };
  mkdirSync(DATA_DIR, { recursive: true });
  const reportPath = path.join(DATA_DIR, "reset-and-import-report.json");
  writeFileSync(reportPath, JSON.stringify(serializable, null, 2));

  console.log("\n=== Resumo ===");
  console.log(`Linhas na planilha: ${report.totalRows}`);
  console.log(`Ignoradas (STATUS vazio/desconhecido): ${report.skippedBlank}`);
  console.log(`Duplicadas na planilha (mesmo office_id/nome+email): ${report.duplicateInSheet}`);
  console.log(`Clientes criados: ${report.created}`);
  console.log(`Parceiro/canal de origem casado automaticamente: ${report.actorMatched}`);
  console.log(`Canais de origem sem correspondência (${report.actorUnmatched.size}): ${serializable.actorUnmatched.join(", ")}`);
  console.log(`Planos casados automaticamente: ${report.planMatched}`);
  console.log(`Planos sem correspondência direta (mantidos como texto, ${report.planUnmatched.size}): ${serializable.planUnmatched.join(", ")}`);
  console.log(`\nRelatório salvo em ${reportPath}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
