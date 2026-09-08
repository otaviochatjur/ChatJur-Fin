// One-off (but safely re-runnable) backfill for candidaturas submitted on
// the "Chat Jurídico Connect" Tally form BEFORE the webhook
// (app/api/webhooks/tally) existed/was configured — a webhook only ever
// receives submissions that happen *after* it's registered, so anything
// submitted earlier only ever lived inside Tally itself and never reached
// `connect_leads`.
//
// Pulls every submission via Tally's REST API (different response shape
// than the webhook payload: `submissions[].responses[]` carries
// `{questionId, answer}` pairs, with the human-readable question title
// resolved separately via the top-level `questions[]` array — already
// resolved to option *labels*, not ids, for choice questions) and maps it
// through the exact same `lib/tally-mapping.ts` rules the live webhook
// uses, so a backfilled row and a freshly-received one are indistinguishable
// once in `connect_leads`.
//
// Idempotent: skips any submission whose id already exists as
// `tally_submission_id` (covers both a prior run of this script and any
// submission the webhook already captured live).
//
// Requires TALLY_API_KEY (Tally → Settings → API Keys — a personal access
// token, NOT the webhook signing secret) in .env.
//
// Run: node scripts/legacy-import/import-tally-submissions.mjs [--dry-run]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DRY_RUN = process.argv.includes("--dry-run");
const FORM_ID = process.argv.find((a) => a.startsWith("--form="))?.split("=")[1] ?? "2EWBOV";

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
const TALLY_API_KEY = process.env.TALLY_API_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados em .env");
  process.exit(1);
}
if (!TALLY_API_KEY) {
  console.error("TALLY_API_KEY não configurado em .env (gere em Tally > Settings > API Keys — token pessoal, diferente do segredo do webhook).");
  process.exit(1);
}

async function sb(urlPath, { method = "GET", body } = {}) {
  const response = await fetch(`${SUPABASE_URL}${urlPath}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Supabase ${method} ${urlPath} -> ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function tally(urlPath) {
  const response = await fetch(`https://api.tally.so${urlPath}`, {
    headers: { Authorization: `Bearer ${TALLY_API_KEY}` },
  });
  if (!response.ok) throw new Error(`Tally GET ${urlPath} -> ${response.status}: ${await response.text()}`);
  return response.json();
}

/** Reconstructs one submission's answers as `{label, value}` pairs — the same shape `mapTallyFieldsToLead` (lib/tally-mapping.ts) already consumes from live webhook deliveries. */
function toFields(submission, questionTitleById) {
  return submission.responses.map((response) => ({
    label: questionTitleById.get(response.questionId) ?? response.questionId,
    value: response.answer,
  }));
}

async function main() {
  // lib/tally-mapping.ts is TypeScript — loaded the same way tests/*.test.mjs
  // already load .ts modules from a plain .mjs script (Node has no native
  // TS loader wired up here), rather than duplicating the mapping rules.
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    root: ROOT,
    cacheDir: "node_modules/.vite-tests/import-tally-submissions",
    resolve: { alias: { "@": ROOT } },
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const { mapTallyFieldsToLead } = await vite.ssrLoadModule("/lib/tally-mapping.ts");
  await vite.close();

  const [legacyTenant] = await sb(`/rest/v1/nexo_tenants?legacy=eq.true&select=id`);
  if (!legacyTenant) throw new Error("Nenhum tenant legado (nexo_tenants.legacy=true) encontrado — ajuste o script para o tenant correto.");
  const tenantId = legacyTenant.id;

  let page = 1;
  let hasMore = true;
  let questionTitleById = null;
  const allSubmissions = [];
  while (hasMore) {
    const data = await tally(`/forms/${encodeURIComponent(FORM_ID)}/submissions?page=${page}&limit=100`);
    if (!questionTitleById) questionTitleById = new Map(data.questions.map((q) => [q.id, q.title]));
    allSubmissions.push(...data.submissions);
    hasMore = data.hasMore;
    page += 1;
  }
  console.log(`Tally: ${allSubmissions.length} submissão(ões) encontrada(s) no formulário ${FORM_ID}.`);

  let imported = 0;
  let skipped = 0;
  for (const submission of allSubmissions) {
    const [existing] = await sb(`/rest/v1/connect_leads?select=id&tally_submission_id=eq.${encodeURIComponent(submission.id)}`);
    if (existing) { skipped += 1; continue; }

    const fields = toFields(submission, questionTitleById);
    const mapped = mapTallyFieldsToLead(fields);
    const row = {
      tenant_id: tenantId,
      tally_submission_id: submission.id,
      tally_response_id: null,
      tally_form_id: submission.formId ?? FORM_ID,
      submitted_at: submission.submittedAt,
      raw_payload: { source: "backfill_api", submission, fields },
      ...mapped,
    };

    if (DRY_RUN) {
      console.log(`[dry-run] importaria ${submission.id} — ${mapped.full_name ?? mapped.company_name ?? mapped.institution_name ?? "(sem nome)"} <${mapped.email ?? "sem e-mail"}>`);
    } else {
      await sb("/rest/v1/connect_leads", { method: "POST", body: row });
      console.log(`Importado ${submission.id} — ${mapped.full_name ?? mapped.company_name ?? mapped.institution_name ?? "(sem nome)"} <${mapped.email ?? "sem e-mail"}>`);
    }
    imported += 1;
  }

  console.log(`\n${DRY_RUN ? "[dry-run] " : ""}Concluído: ${imported} nova(s) candidatura(s) importada(s), ${skipped} já existente(s) (ignorada(s)).`);
}

main().catch((error) => { console.error(error); process.exit(1); });
