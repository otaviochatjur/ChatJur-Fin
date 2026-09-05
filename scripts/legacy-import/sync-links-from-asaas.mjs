// One-off/standalone runner for the same logic as
// app/api/asaas/sync-links/route.ts, so it can be triggered from the CLI
// without needing the Next.js dev server up. Pulls every payment link that
// exists in the real Asaas account and creates a row (actor_id/plan_id
// null, status PENDING) for any we don't already track.
//
// Run: node scripts/legacy-import/sync-links-from-asaas.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

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
const ASAAS_BASE_URL = process.env.ASAAS_BASE_URL;
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados."); process.exit(1); }
if (!ASAAS_BASE_URL || !ASAAS_API_KEY) { console.error("ASAAS_BASE_URL / ASAAS_API_KEY não configurados."); process.exit(1); }

async function sb(urlPath, { method = "GET", body } = {}) {
  const response = await fetch(`${SUPABASE_URL}${urlPath}`, {
    method,
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${urlPath} -> ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function asaas(offset) {
  const url = new URL(`${ASAAS_BASE_URL}/paymentLinks`);
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", String(offset));
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", "User-Agent": "ChatJuridicoFinanceiro/1.0", access_token: ASAAS_API_KEY },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Asaas /paymentLinks -> ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

function inferBillingPeriod(link) {
  return link.chargeType === "INSTALLMENT" ? "ANNUAL" : "MONTHLY";
}

async function main() {
  const known = await sb("/rest/v1/payment_links?select=asaas_payment_link_id&asaas_payment_link_id=not.is.null");
  const knownIds = new Set(known.map((row) => row.asaas_payment_link_id));

  let offset = 0;
  let hasMore = true;
  let totalSeen = 0;
  let imported = 0;
  let skippedNoValue = 0;
  let skippedDeleted = 0;
  const importedNames = [];

  while (hasMore) {
    const page = await asaas(offset);
    for (const link of page.data) {
      totalSeen += 1;
      if (knownIds.has(link.id)) continue;
      if (link.deleted) { skippedDeleted += 1; continue; }
      const value = Number(link.value);
      if (!Number.isFinite(value) || value <= 0) { skippedNoValue += 1; continue; }

      await sb("/rest/v1/payment_links", {
        method: "POST",
        body: {
          actor_id: null,
          plan_id: null,
          custom_plan_id: null,
          asaas_payment_link_id: link.id,
          external_reference: link.externalReference || `ASAAS_${link.id}`,
          url: link.url ?? null,
          display_name: link.name ?? "Link sem nome",
          value,
          billing_period: inferBillingPeriod(link),
          max_installments: link.chargeType === "INSTALLMENT" ? link.maxInstallmentCount ?? null : null,
          status: "PENDING",
          source: "ASAAS_SYNC",
        },
      });
      knownIds.add(link.id);
      imported += 1;
      importedNames.push(`${link.name} (${value})`);
    }
    hasMore = page.hasMore;
    offset += 100;
  }

  console.log(`Total de links na conta Asaas: ${totalSeen}`);
  console.log(`Importados como pendentes: ${imported}`);
  console.log(`Ignorados (sem valor fixo): ${skippedNoValue}`);
  console.log(`Ignorados (excluídos no Asaas): ${skippedDeleted}`);
  if (importedNames.length) {
    console.log("\nLinks importados:");
    for (const name of importedNames) console.log(` - ${name}`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
