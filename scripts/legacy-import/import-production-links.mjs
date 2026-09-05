// One-off (but safely re-runnable) import that reconciles the *live* Asaas
// payment links export (c:\Users\otavi\Downloads\Links de Pagamento.xlsx,
// dumped to data/asaas_payment_links_export.json) against our commercial
// actors, so historical/production links generated directly in Asaas (before
// this CRM existed) become visible and attributed inside the app.
//
// What this does:
//   1. Creates a handful of new commercial_actors that show up in the export
//      but were never registered here (detected via "parc-"/"emb-" slugs in
//      externalReference, or explicit "Parceiro X" / "Indicação X" wording).
//   2. Upserts a payment_links row (source=LEGACY_IMPORT, legacy=true) for
//      every link in MAPPING, pointing at the right actor.
//
// This is intentionally scoped to links we could confidently attribute to a
// specific partner/ambassador/external seller. The export has ~239 links;
// most of the rest are either the generic direct-sale catalog (no partner
// involved) or one-off custom-price links for a single named client (not a
// reusable partner link) — those are left untouched on purpose so nobody
// gets credited with revenue they didn't bring in. See the chat summary for
// the full breakdown.
//
// This does NOT sync payments/subscriptions — it only creates the
// attribution metadata (payment_links). Run the existing "Sincronizar
// pagamentos" flow afterwards, whenever you're ready for it to start
// counting towards commissions.
//
// Run: node scripts/legacy-import/import-production-links.mjs

import { readFileSync } from "node:fs";
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
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados em .env");
  process.exit(1);
}

async function sb(path, { method = "GET", body, prefer } = {}) {
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
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

// New actors this export revealed that don't exist in commercial_actors yet.
const NEW_ACTORS = [
  { name: "ADVBox", role: "PARTNER" },
  { name: "Apogeu", role: "PARTNER" },
  { name: "Rota Experience", role: "PARTNER" },
  { name: "DiAcordo", role: "PARTNER" },
  { name: "Malbio", role: "PARTNER" },
  { name: "Marcel Pedro", role: "AMBASSADOR" },
  { name: "André Janeiro", role: "AMBASSADOR" },
  { name: "Gilberto Mendes", role: "EXTERNAL_SALES" },
];

// asaas payment link id -> exact commercial_actors.name to attribute it to
// (existing actors already in the CRM, matched from the link's name/
// description/externalReference).
const MAPPING = {
  mo8zs0clotfpakvd: "Cálculo Jurídico",
  vu92xjqgj0slbs81: "Cálculo Jurídico",
  beprxqu8lsog0mit: "Cálculo Jurídico",
  hhwfemeef8mnumsd: "ADV 10X",
  xasrrwyvwluppelh: "ADV 10X",
  "8vlgygff1tkd1e9q": "ADV 10X",
  "6631h85zpgehjt35": "ADV 10X",
  "9tjf398n9zdw51kg": "ADV 10X",
  t8g2svfa52m772k1: "ADV 10X",
  o14hmrazox1356lg: "Pedro Hidasi",
  "3bthx8u4bh87jjl0": "Monaliza Krepe",
  xvkybt1x07if6ne5: "Dr. Marcos Vilas Boas",
  n8iqn4jh72n5ex7u: "Dra. Lívia Leal",
  ohsqdrwpkqid48my: "Dra. Lidiane Alves",
  aukki3ka8tnm78v5: "Dra. Jacqueline Cenerini",
  bqxvwb7ire2vycx7: "Bruna Ribeiro",
  j4xea9mcshafrp25: "Adam Gustavo",
  rhizrpcq7t8ngq3o: "Paloma Tavares",
  fdbcvd778cymqs2a: "ADV 10X",
  "9ci5qsdfdluccrzc": "ADV 10X",
  za02nz2wrl71m3ya: "ADV 10X",
  "2eqjofq1ptpvdsjr": "ADV 10X",
  apcybyh50aipmrrj: "ADV 10X",
  "195s1390wvx8whkh": "ADV 10X",
  "38376e6ks99zpi1d": "Jurídico do Caos",
  "2qmqxsw7k7wktoxm": "Cálculo Jurídico",
  xm5wela77uyxdwig: "Cálculo Jurídico",
  foge5hhxzu0xhr90: "Cálculo Jurídico",
  // newly created below
  h85wbdek468avdgi: "ADVBox",
  "89aw5m6r9wzslirs": "ADVBox",
  gnfywduzeg5mde8n: "Apogeu",
  v02vkia6pqtax0lk: "Apogeu",
  usqcsthikyr3dg9h: "Rota Experience",
  nyhmoiw7742tqwt0: "Rota Experience",
  "74mxcjd7k2e33hco": "Marcel Pedro",
  "5skm273vhma7qwy6": "Marcel Pedro",
  ruimmiafl3c3iv0j: "André Janeiro",
  wgapxudy44ca5u9i: "André Janeiro",
  eq8wja2bn8zx0gda: "DiAcordo",
  z1m9sat3to26v39d: "Malbio",
  tkv0io5vfw6w9zey: "Gilberto Mendes",
  // existing actor, name mismatch (spreadsheet omits the surname)
  uu82htwohowao2cm: "Dra. Márcia Isabel Hartmann",
};

function deriveBillingPeriod(row) {
  if (row.subscriptionCycle === "MONTHLY") {
    return { billing_period: "MONTHLY", max_installments: null };
  }
  const max = Number.isFinite(row.maxInstallmentCount) && row.maxInstallmentCount > 0 ? Math.min(row.maxInstallmentCount, 12) : 1;
  return { billing_period: "ANNUAL", max_installments: max };
}

async function main() {
  const exportRows = JSON.parse(readFileSync(path.join(DATA_DIR, "asaas_payment_links_export.json"), "utf-8"));
  const rowById = new Map(exportRows.map((row) => [row.id, row]));

  console.log("Criando atores novos (idempotente)...");
  const actorIdByName = new Map();
  const existingActors = await sb("/rest/v1/commercial_actors?select=id,name,role");
  for (const actor of existingActors) actorIdByName.set(actor.name, actor.id);

  for (const actor of NEW_ACTORS) {
    if (actorIdByName.has(actor.name)) {
      console.log(`  já existe: ${actor.name}`);
      continue;
    }
    const [created] = await sb("/rest/v1/commercial_actors", {
      method: "POST",
      prefer: "return=representation",
      body: { name: actor.name, role: actor.role, status: "ACTIVE" },
    });
    actorIdByName.set(actor.name, created.id);
    console.log(`  criado: ${actor.name} (${actor.role})`);
  }

  console.log("\nVinculando links de pagamento (idempotente)...");
  let created = 0;
  let skippedExisting = 0;
  const errors = [];

  for (const [asaasId, actorName] of Object.entries(MAPPING)) {
    const row = rowById.get(asaasId);
    if (!row) {
      errors.push(`${asaasId}: não encontrado no export`);
      continue;
    }
    const actorId = actorIdByName.get(actorName);
    if (!actorId) {
      errors.push(`${asaasId}: ator "${actorName}" não encontrado/criado`);
      continue;
    }

    const externalReference = `LEGACY_${asaasId}`;
    const existing = await sb(`/rest/v1/payment_links?select=id&external_reference=eq.${encodeURIComponent(externalReference)}`);
    if (existing[0]) {
      skippedExisting += 1;
      continue;
    }

    const { billing_period, max_installments } = deriveBillingPeriod(row);
    await sb("/rest/v1/payment_links", {
      method: "POST",
      body: {
        actor_id: actorId,
        plan_id: null,
        custom_plan_id: null,
        price_version_id: null,
        asaas_payment_link_id: asaasId,
        external_reference: externalReference,
        url: row.url,
        display_name: row.name,
        value: row.value,
        billing_period,
        max_installments,
        legacy: true,
        status: row.active ? "ACTIVE" : "INACTIVE",
        source: "LEGACY_IMPORT",
      },
    });
    created += 1;
    console.log(`  + ${actorName}: ${row.name} (R$ ${row.value})`);
  }

  console.log(`\nResumo: ${created} links criados, ${skippedExisting} já existiam.`);
  if (errors.length) {
    console.log(`Erros (${errors.length}):`);
    for (const error of errors) console.log(`  - ${error}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
