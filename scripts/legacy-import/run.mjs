// One-off import of the legacy commercial spreadsheets into Supabase.
//
// Run `python scripts/legacy-import/prepare.py` first to (re)generate the
// JSON this script consumes, then:
//   node scripts/legacy-import/run.mjs
//
// Safe to re-run: every write is a "find or create" keyed by a natural
// identifier (office_id, actor name+role, link external_reference), so
// running it twice does not duplicate rows.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(__dirname, "data");

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    value = value.replace(/^\\\$/, "$"); // undo the wrangler-parser escape used for ASAAS_API_KEY
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados em .env");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sb(path, { method = "GET", body, prefer } = {}) {
  // Only GET is safe to blindly retry: right after the migration, PostgREST's
  // schema cache can 404 on a table that demonstrably exists (confirmed
  // flaky across edge nodes, observed even 2+ minutes post-migration). Writes
  // (POST/PATCH/DELETE) must NOT be retried here — if a write actually
  // committed but the client received a spurious 404, resending it would
  // silently create a duplicate row. main() runs a GET-only warm-up before
  // any writes to make this a non-issue in practice.
  const maxAttempts = method === "GET" ? 5 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
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
    if (response.ok) return data;

    if (attempt < maxAttempts && response.status === 404) {
      console.log(`  (schema cache ainda propagando, tentativa ${attempt}/${maxAttempts} para ${path})`);
      await sleep(attempt * 2000);
      continue;
    }
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(data)}`);
  }
}

async function warmUpSchemaCache() {
  const tables = ["customers", "subscriptions", "payments", "commercial_actors", "payment_links"];
  console.log("Aquecendo o cache de schema do PostgREST antes de escrever...");
  for (let round = 1; round <= 10; round += 1) {
    let allOk = true;
    for (const table of tables) {
      try {
        await sb(`/rest/v1/${table}?select=id&limit=1`);
      } catch {
        allOk = false;
      }
    }
    if (allOk) {
      console.log(`Cache de schema OK (confirmado na rodada ${round}).`);
      return;
    }
    await sleep(3000);
  }
  throw new Error("Cache de schema do PostgREST não estabilizou a tempo. Rode `NOTIFY pgrst, 'reload schema';` no SQL editor e tente de novo.");
}

function readJson(name) {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), "utf-8"));
}

function normalize(text) {
  return (text ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const report = {
  partners: { created: 0, updated: 0 },
  ambassadors: { created: 0, updated: 0 },
  externalSalesActors: { created: 0, updated: 0 },
  legacyLinks: { created: 0, updated: 0, skipped: [] },
  clients: { created: 0, updated: 0, planMatched: 0, planUnmatched: [], actorMatched: 0, actorUnmatched: new Set() },
};

// --- Step 1: partners + ambassadors -> commercial_actors ------------------

async function upsertActor({ name, role, coupon, reference_code }) {
  const existing = await sb(`/rest/v1/commercial_actors?select=id,coupon,reference_code&role=eq.${role}&name=eq.${encodeURIComponent(name)}`);
  if (existing[0]) {
    if (coupon || reference_code) {
      await sb(`/rest/v1/commercial_actors?id=eq.${existing[0].id}`, { method: "PATCH", body: { coupon: coupon ?? existing[0].coupon, reference_code: reference_code ?? existing[0].reference_code } });
      report[role === "PARTNER" ? "partners" : role === "AMBASSADOR" ? "ambassadors" : "externalSalesActors"].updated += 1;
    }
    return existing[0].id;
  }
  const [created] = await sb("/rest/v1/commercial_actors", { method: "POST", prefer: "return=representation", body: { name, role, coupon: coupon ?? null, reference_code: reference_code ?? null, status: "ACTIVE" } });
  const bucket = role === "PARTNER" ? "partners" : role === "AMBASSADOR" ? "ambassadors" : "externalSalesActors";
  if (report[bucket]) report[bucket].created += 1;
  return created.id;
}

async function importPartnersAndAmbassadors() {
  const partners = readJson("partners.json");
  const ambassadors = readJson("ambassadors.json");
  const actorIndex = []; // [{ id, name, role }] for later fuzzy matching

  for (const partner of partners) {
    const id = await upsertActor({ name: partner.name, role: "PARTNER", coupon: partner.coupon, reference_code: partner.reference_code });
    actorIndex.push({ id, name: partner.name, role: "PARTNER" });
  }
  for (const ambassador of ambassadors) {
    const id = await upsertActor({ name: ambassador.name, role: "AMBASSADOR", coupon: ambassador.coupon, reference_code: ambassador.reference_code });
    actorIndex.push({ id, name: ambassador.name, role: "AMBASSADOR" });
  }
  console.log(`Parceiros/embaixadores: ${report.partners.created + report.partners.updated} parceiros, ${report.ambassadors.created + report.ambassadors.updated} embaixadores processados.`);
  return actorIndex;
}

function fuzzyFindActor(actorIndex, name) {
  const target = normalize(name);
  if (!target) return null;
  return actorIndex.find((actor) => {
    const known = normalize(actor.name);
    return known === target || known.includes(target) || target.includes(known);
  }) ?? null;
}

// --- Step 2: legacy Asaas links ---------------------------------------------

async function importLegacyLinks(actorIndex) {
  const links = readJson("legacy_links.json");
  for (const link of links) {
    let match = fuzzyFindActor(actorIndex, link.actor_name);
    if (!match) {
      const id = await upsertActor({ name: link.actor_name, role: "EXTERNAL_SALES" });
      match = { id, name: link.actor_name, role: "EXTERNAL_SALES" };
      actorIndex.push(match);
    }

    const externalReference = link.asaas_payment_link_id
      ? `LEGACY_${link.asaas_payment_link_id}`
      : `LEGACY_${normalize(link.actor_name)}_${normalize(link.plan_text)}`;

    const existing = await sb(`/rest/v1/payment_links?select=id&external_reference=eq.${encodeURIComponent(externalReference)}`);
    if (existing[0]) {
      report.legacyLinks.updated += 1;
      continue;
    }
    if (link.value === null) {
      report.legacyLinks.skipped.push(`${link.actor_name}: ${link.plan_text} (sem valor)`);
      continue;
    }

    await sb("/rest/v1/payment_links", {
      method: "POST",
      body: {
        actor_id: match.id,
        plan_id: null,
        custom_plan_id: null,
        price_version_id: null,
        asaas_payment_link_id: link.asaas_payment_link_id,
        external_reference: externalReference,
        url: link.url,
        display_name: link.display_name,
        value: link.value,
        billing_period: link.billing_period,
        max_installments: link.max_installments,
        legacy: true,
        status: "ACTIVE",
        source: "LEGACY_IMPORT",
      },
    });
    report.legacyLinks.created += 1;
  }
  console.log(`Links legados: ${report.legacyLinks.created} criados, ${report.legacyLinks.updated} já existiam, ${report.legacyLinks.skipped.length} sem valor (ignorados).`);
}

// --- Step 3: 739 historical clients -> customers + subscriptions -----------

function matchPlan(plansCatalog, planNameRaw, billingPeriod) {
  const normalized = normalize(planNameRaw);
  // Heuristic learned from cross-referencing spreadsheet values against the
  // live catalog: "IA 100"/"IA 100 v2"/"CRM+IA" share CRM + IA's price point
  // (297/mo, 2490/yr); "IA +" and its "Aniversário" variants share CRM + IA
  // Plus's (597/mo, ~4970/yr). "CRM" and "Exclusive" don't map cleanly and
  // are kept as plan_name_raw only.
  let targetName = null;
  if (["ia100", "ia100v2", "crmia"].includes(normalized)) targetName = "CRM + IA";
  else if (normalized.startsWith("ia") && normalized.includes("aniversario")) targetName = "CRM + IA Plus";
  else if (normalized === "ia" || normalized === "iaplus" || normalized === "ia+") targetName = "CRM + IA Plus";
  if (!targetName) return null;
  return plansCatalog.find((plan) => normalize(plan.name) === normalize(targetName) && plan.billing_period === billingPeriod)?.id ?? null;
}

async function importClients(actorIndex) {
  const clients = readJson("clients.json");
  const plansCatalog = await sb("/rest/v1/plans?select=id,name,billing_period");

  let processed = 0;
  for (const client of clients) {
    let customerId;
    const existing = client.external_office_id
      ? await sb(`/rest/v1/customers?select=id&external_office_id=eq.${encodeURIComponent(client.external_office_id)}`)
      // ~21 of 739 rows have no office_id in the spreadsheet; fall back to an
      // exact office_name match (scoped to other office_id-less rows) so a
      // re-run of this script stays idempotent for them too.
      : await sb(`/rest/v1/customers?select=id&external_office_id=is.null&office_name=eq.${encodeURIComponent(client.office_name)}`);

    const customerBody = {
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
      api_oficial: client.api_oficial,
      signed_at: client.signed_at,
      cancelled_at: client.cancelled_at,
      cancellation_category: client.cancellation_category,
      cancellation_reason: client.cancellation_reason,
      comments: client.comments,
      implementation_date: client.implementation_date,
      implementation_value: client.implementation_value,
    };

    const actorMatch = client.source_channel ? fuzzyFindActor(actorIndex, client.source_channel) : null;
    if (actorMatch) { customerBody.acquisition_actor_id = actorMatch.id; report.clients.actorMatched += 1; }
    else if (client.source_channel) report.clients.actorUnmatched.add(client.source_channel);

    if (existing[0]) {
      customerId = existing[0].id;
      await sb(`/rest/v1/customers?id=eq.${customerId}`, { method: "PATCH", body: customerBody });
      report.clients.updated += 1;
    } else {
      const [created] = await sb("/rest/v1/customers", { method: "POST", prefer: "return=representation", body: customerBody });
      customerId = created.id;
      report.clients.created += 1;
    }

    const existingSubscription = await sb(`/rest/v1/subscriptions?select=id&customer_id=eq.${customerId}&source=eq.LEGACY_IMPORT`);
    if (existingSubscription[0]) continue; // idempotent re-run

    const planId = matchPlan(plansCatalog, client.plan_name_raw, client.billing_period);
    if (planId) report.clients.planMatched += 1;
    else if (client.plan_name_raw) report.clients.planUnmatched.push(client.plan_name_raw);

    await sb("/rest/v1/subscriptions", {
      method: "POST",
      body: {
        customer_id: customerId,
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

    processed += 1;
    if (processed % 50 === 0) console.log(`  ... ${processed}/${clients.length} clientes processados`);
  }
  console.log(`Clientes: ${report.clients.created} criados, ${report.clients.updated} atualizados.`);
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.error("Rode primeiro: python scripts/legacy-import/prepare.py");
    process.exit(1);
  }
  await warmUpSchemaCache();
  const actorIndex = await importPartnersAndAmbassadors();
  await importLegacyLinks(actorIndex);
  await importClients(actorIndex);

  const reportPath = path.join(DATA_DIR, "import-report.json");
  const serializable = { ...report, clients: { ...report.clients, actorUnmatched: Array.from(report.clients.actorUnmatched) } };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(serializable, null, 2));
  console.log(`\nRelatório salvo em ${reportPath}`);
  console.log(`Planos mapeados automaticamente: ${report.clients.planMatched}`);
  console.log(`Nomes de plano sem mapeamento direto (mantidos como texto): ${new Set(report.clients.planUnmatched).size} variações`);
  console.log(`Canais/parceiros de origem sem correspondência: ${report.clients.actorUnmatched.size}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
