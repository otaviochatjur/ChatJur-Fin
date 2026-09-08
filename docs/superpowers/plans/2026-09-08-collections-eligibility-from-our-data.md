# Cobrança: elegibilidade e envio a partir da nossa base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer os dois caminhos de cobrança — manual (`app/api/collections`) e automático (`lib/collection-schedule-server.ts`) — decidirem elegibilidade e resolverem o destino do WhatsApp usando nossa própria base (`customers`, sincronizada via nosso Asaas), em vez de depender de um vínculo com pagamentos do Chat Jurídico — integração que está desconectada desde 2026-03-16 e por isso bloqueava 100% das prévias manuais e zerava silenciosamente a fila da programação automática todo dia.

**Architecture:** `previewCollection` passa a receber um `BillingCustomer` (nossa tabela `customers`, resolvido por `asaas_customer_id`) em vez de um `BillingContact` do Chat Jurídico. O telefone de destino vem de `ReportSnapshot.phone` (já vem do Asaas em todo relatório) com `customers.phone` como reforço, ambos passando por uma função de normalização nova. O envio (`dispatchCollection`) resolve/cria o contato do WhatsApp pelo telefone na hora de despachar (`GET /v1/contacts?phone=`, `POST /v1/contacts` se preciso), no lugar de usar um `contact_id` pré-vinculado. Um script one-off aplica o `status` (`ACTIVE`/`CANCELLED`/`FROZEN`) na base a partir da planilha ⭐ Base de Clientes, só para quem hoje está `null`.

**Tech Stack:** Next.js (route handlers), TypeScript, Supabase (Postgres via REST), node:test + Vite `ssrLoadModule` para testes, script Node puro para o backfill.

## Global Constraints

- Nunca sobrescrever um `customers.status` que já não seja `null` (nem no backfill, nem em qualquer código novo).
- `previewCollection` continua uma função pura (sem I/O) — toda busca de dados (Supabase, Chat Jurídico, Asaas) fica nos chamadores (`app/api/collections/route.ts`, `lib/collection-dispatch.ts`).
- Nenhuma mudança na lógica de estágios/calendário (`collectionSchedule`, `COLLECTION_STAGES`, `isCollectionBusinessDay`) nem na geração do relatório do Asaas (`lib/collection-reports-server.ts`) — ambos já funcionam.
- Rodar `node --test tests/*.test.mjs` e `npm run build` sem falhas antes de considerar qualquer task concluída.
- Nenhum envio real de mensagem acontece durante a implementação/testes — todo teste usa `fetch` mockado.

---

### Task 1: Normalização de telefone

**Files:**
- Modify: `lib/collection-policy.ts` (adicionar `normalizePhone` perto do topo, depois dos imports)
- Test: `tests/collection-policy.test.mjs`

**Interfaces:**
- Produces: `export function normalizePhone(raw: string | null | undefined): string | null` — dígitos puros com `55` na frente (ex: `5511940777545`), ou `null` se o valor não for um telefone brasileiro válido (nem 10/11 dígitos sem DDI, nem 12/13 já com `55`).

- [ ] **Step 1: Write the failing test**

Adicionar ao final de `tests/collection-policy.test.mjs` (antes do `await vite.ssrLoadModule` extra do último teste, ou como um novo `test(...)` no fim do arquivo):

```js
test("normalizes Brazilian phone numbers to digits-only with country code", () => {
  assert.equal(normalizePhone("11940777545"), "5511940777545");
  assert.equal(normalizePhone("(11) 94077-7545"), "5511940777545");
  assert.equal(normalizePhone("(15) 3224-3271"), "551532243271");
  assert.equal(normalizePhone("5511940777545"), "5511940777545");
  assert.equal(normalizePhone("+55 (11) 94077-7545"), "5511940777545");
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("123"), null);
  assert.equal(normalizePhone("123456789012345"), null);
});
```

E adicionar `normalizePhone` à desestruturação do `ssrLoadModule` no topo do arquivo:

```js
const { previewCollection, dayDistance, collectionToday, FINANCIAL_INSTANCE, COLLECTION_STAGES, normalizePhone } = await vite.ssrLoadModule("/lib/collection-policy.ts");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/collection-policy.test.mjs`
Expected: FAIL — `normalizePhone is not a function` (ou `undefined`).

- [ ] **Step 3: Write minimal implementation**

Em `lib/collection-policy.ts`, logo abaixo do `import` do topo (antes de `export const FINANCIAL_INSTANCE`):

```ts
/** Digits-only Brazilian phone with country code (ex: "5511940777545"), or null if it doesn't look like a real number. Accepts already-formatted input ("(11) 94077-7545") or raw digits with/without the leading "55". */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/collection-policy.test.mjs`
Expected: PASS (todos os testes do arquivo, incluindo os já existentes).

- [ ] **Step 5: Commit**

```bash
git add lib/collection-policy.ts tests/collection-policy.test.mjs
git commit -m "collections: add Brazilian phone normalization helper"
```

---

### Task 2: Backfill de `customers.status` a partir da planilha ⭐ Base de Clientes

**Files:**
- Create: `scripts/legacy-import/backfill-customer-status-from-sheet.mjs`

**Interfaces:**
- Consumes: `CLIENTS_SHEET_WEBHOOK_URL` / `CLIENTS_SHEET_WEBHOOK_AUTH` (`.env`, já usados por `lib/clients-allowlist.ts`), `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (`.env`).
- Produces: nenhuma interface consumida por outro código — script standalone, rodado uma vez manualmente.

- [ ] **Step 1: Escrever o script**

```js
// One-off (mas seguro para rodar de novo) backfill de customers.status a
// partir da coluna STATUS da planilha "⭐ Base de Clientes" — só preenche
// quem hoje está status = null (nunca sobrescreve uma confirmação manual já
// existente). Ver docs/superpowers/specs/2026-09-08-collections-eligibility-from-our-data-design.md.
//
// Mapeamento: "Ativo" -> ACTIVE, "Cancelado" -> CANCELLED, "Congelada" -> FROZEN.
// Vazio ou sem correspondência na planilha: não mexe (fica null).
//
// Casamento: por customers.external_office_id = planilha.office_id
// (prioridade); se não achar, por email (case-insensitive).
//
// Run: node scripts/legacy-import/backfill-customer-status-from-sheet.mjs [--dry-run]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DRY_RUN = process.argv.includes("--dry-run");

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

async function sb(urlPath, { method = "GET", body } = {}) {
  const response = await fetch(`${SUPABASE_URL}${urlPath}`, {
    method,
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Supabase ${method} ${urlPath} -> ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

const STATUS_MAP = { "Ativo": "ACTIVE", "Cancelado": "CANCELLED", "Congelada": "FROZEN" };

async function main() {
  const sheetResponse = await fetch(SHEET_URL, { headers: SHEET_AUTH ? { "sisfin-auth": SHEET_AUTH } : undefined });
  if (!sheetResponse.ok) throw new Error(`Base de Clientes webhook -> ${sheetResponse.status}`);
  const sheetRows = await sheetResponse.json();
  if (!Array.isArray(sheetRows)) throw new Error("Base de Clientes webhook não retornou uma lista.");

  const byOfficeId = new Map();
  const byEmail = new Map();
  for (const row of sheetRows) {
    if (row.office_id) byOfficeId.set(row.office_id, row);
    if (row.Email) byEmail.set(String(row.Email).trim().toLowerCase(), row);
  }
  console.log(`Planilha: ${sheetRows.length} linha(s).`);

  const customers = await sb("/rest/v1/customers?select=id,external_office_id,email&status=is.null");
  console.log(`Clientes com status null na nossa base: ${customers.length}.`);

  const counts = { ACTIVE: 0, CANCELLED: 0, FROZEN: 0, semCorrespondencia: 0, statusDesconhecido: 0 };
  const semCorrespondencia = [];
  for (const customer of customers) {
    const sheetRow = (customer.external_office_id && byOfficeId.get(customer.external_office_id))
      ?? (customer.email && byEmail.get(customer.email.trim().toLowerCase()));
    if (!sheetRow) { counts.semCorrespondencia += 1; semCorrespondencia.push(customer.id); continue; }
    const mapped = STATUS_MAP[sheetRow.STATUS];
    if (!mapped) { counts.statusDesconhecido += 1; continue; }
    counts[mapped] += 1;
    if (!DRY_RUN) await sb(`/rest/v1/customers?id=eq.${customer.id}`, { method: "PATCH", body: { status: mapped } });
  }

  console.log(`\n${DRY_RUN ? "[dry-run] " : ""}Resultado:`);
  console.log(`  ACTIVE: ${counts.ACTIVE}`);
  console.log(`  CANCELLED: ${counts.CANCELLED}`);
  console.log(`  FROZEN: ${counts.FROZEN}`);
  console.log(`  Sem correspondência na planilha (ficou null): ${counts.semCorrespondencia}`);
  console.log(`  STATUS da planilha não mapeado/vazio (ficou null): ${counts.statusDesconhecido}`);
  if (semCorrespondencia.length) console.log(`  IDs sem correspondência: ${semCorrespondencia.join(", ")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 2: Rodar em modo dry-run e conferir contra o diagnóstico já feito**

Run: `node scripts/legacy-import/backfill-customer-status-from-sheet.mjs --dry-run`
Expected: `ACTIVE: 482`, `CANCELLED: 264`, `FROZEN: 1`, `Sem correspondência: 0` (bate com o diagnóstico feito na conversa/spec — se os números vierem diferentes, PARE e investigue antes de aplicar de verdade).

- [ ] **Step 3: Rodar de verdade**

Run: `node scripts/legacy-import/backfill-customer-status-from-sheet.mjs`
Expected: mesmos números do dry-run, sem o prefixo `[dry-run]`.

- [ ] **Step 4: Confirmar no banco**

Run (ou equivalente via um script curto de leitura): consultar `select status, count(*) from customers group by status` — deve mostrar `null: <o que sobrou>`, `ACTIVE: 482 (+ o que já era ACTIVE antes)`, `CANCELLED: 264`, `FROZEN: 1`.

- [ ] **Step 5: Commit**

```bash
git add scripts/legacy-import/backfill-customer-status-from-sheet.mjs
git commit -m "customers: backfill status from Base de Clientes sheet (one-off)"
```

---

### Task 3: `previewCollection` passa a receber `BillingCustomer` (nossa base) em vez de `BillingContact` (Chat Jurídico)

**Files:**
- Modify: `lib/collection-policy.ts`
- Modify: `tests/collection-policy.test.mjs`

**Interfaces:**
- Consumes: `normalizePhone` (Task 1, mesmo arquivo).
- Produces:
  - `export type BillingCustomer = { id: string; status: "ACTIVE" | "CANCELLED" | "FROZEN" | null; phone: string | null; name: string | null }`
  - `export type CustomerRow = { id: string; asaas_customer_id: string; status: "ACTIVE" | "CANCELLED" | "FROZEN" | null; phone: string | null; responsible_name: string | null; office_name: string | null }` — shape de uma linha de `customers` (nosso Supabase), usada tanto por `app/api/collections/route.ts` (Task 4) quanto por `lib/collection-schedule-server.ts` (Task 6).
  - `export function toBillingCustomer(row: CustomerRow | null | undefined, snapshotPhone: string | null): BillingCustomer | null` — função pura, sem I/O: monta o `BillingCustomer` a partir de uma linha de `customers`, preferindo `snapshotPhone` (do Asaas, já normalizado por quem chama) e caindo para `row.phone`.
  - `export function previewCollection(payment: BillingPayment, customer: BillingCustomer | null, templates: BillingTemplate[], today: string, rules?: CollectionRule[], calendar?: CollectionCalendar): CollectionPreview` — mesma posição de parâmetro, tipo do 2º argumento mudou.
  - `CollectionPreview` ganha `customer: BillingCustomer | null` no lugar de `contact: BillingContact | null`.
  - `BillingContact` continua existindo (ainda usado por `lib/collection-schedule-server.ts` para nada relacionado a `previewCollection`, e pelo `lib/collection-dispatch.ts` da Task 5 — não remover), só deixa de ser usado dentro de `previewCollection`.

- [ ] **Step 1: Write the failing test**

Substituir, em `tests/collection-policy.test.mjs`, a definição de `contact` e os dois testes que a usam (linhas 10, 19-26, 27-37 do arquivo atual) por:

```js
const customer = { id: "customer-1", status: "ACTIVE", phone: "5511999999999", name: "Ana" };
```

```js
test("renders exactly the approved template variables", () => {
  const result = previewCollection(payment, customer, [template], "2026-09-09");
  assert.equal(result.blocked, null);
  assert.equal(result.text, "Olá Ana, vencimento 08/09/2026: https://asaas.com/i/example");
  assert.deepEqual(result.parameters, { body_1: "Ana", body_2: "08/09/2026", body_3: payment.invoice_url });
  const simple = previewCollection(payment, customer, [{ ...template, components: [{ type: "BODY", text: "Olá {{1}}" }] }], "2026-09-09");
  assert.deepEqual(simple.parameters, { body_1: "Ana" });
});
test("blocks unknown, non-active, unpaid, phoneless, missing-template and incomplete previews", () => {
  for (const [p, c, t] of [
    [payment, null, [template]],
    [payment, { ...customer, status: "CANCELLED" }, [template]],
    [payment, { ...customer, status: null }, [template]],
    [{ ...payment, status: "RECEIVED" }, customer, [template]],
    [payment, { ...customer, phone: null }, [template]],
    [payment, customer, []],
    [{ ...payment, invoice_url: null }, customer, [template]],
    [payment, customer, [{ ...template, components: [{ type: "BODY", text: "{{4}}" }] }]],
    [payment, customer, [{ ...template, components: [{ type: "HEADER", format: "IMAGE" }] }]],
  ]) assert.ok(previewCollection(p, c, t, "2026-09-09").blocked);
  assert.equal(previewCollection(payment, customer, [template], "2026-09-11").blocked, "Sem envio hoje");
});
test("toBillingCustomer prefers the snapshot phone over the stored one, and returns null without a row", () => {
  const row = { id: "db-1", asaas_customer_id: "cus_1", status: "ACTIVE", phone: "(11) 94077-7545", responsible_name: "Ana", office_name: "Escritório Ana" };
  assert.deepEqual(toBillingCustomer(row, "11988887777"), { id: "db-1", status: "ACTIVE", phone: "5511988887777", name: "Ana" });
  assert.deepEqual(toBillingCustomer(row, null), { id: "db-1", status: "ACTIVE", phone: "5511940777545", name: "Ana" });
  assert.deepEqual(toBillingCustomer({ ...row, responsible_name: null }, null), { id: "db-1", status: "ACTIVE", phone: "5511940777545", name: "Escritório Ana" });
  assert.equal(toBillingCustomer(null, "11988887777"), null);
  assert.equal(toBillingCustomer(undefined, "11988887777"), null);
});
```

Adicionar `toBillingCustomer` à desestruturação do `ssrLoadModule` no topo do arquivo (junto com `normalizePhone` da Task 1):

```js
const { previewCollection, dayDistance, collectionToday, FINANCIAL_INSTANCE, COLLECTION_STAGES, normalizePhone, toBillingCustomer } = await vite.ssrLoadModule("/lib/collection-policy.ts");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/collection-policy.test.mjs`
Expected: FAIL — o teste antigo usava `contact.is_active`/`instance_id`, que `previewCollection` ainda espera; com `customer` no lugar, os `blocked` esperados não batem (a implementação ainda não entende `status`/`name`); `toBillingCustomer` ainda não existe.

- [ ] **Step 3: Write minimal implementation**

Em `lib/collection-policy.ts`, substituir a definição de `CollectionPreview` e o corpo de `previewCollection`:

```ts
export type BillingCustomer = { id: string; status: "ACTIVE" | "CANCELLED" | "FROZEN" | null; phone: string | null; name: string | null };
export type CustomerRow = { id: string; asaas_customer_id: string; status: "ACTIVE" | "CANCELLED" | "FROZEN" | null; phone: string | null; responsible_name: string | null; office_name: string | null };
/** Builds a BillingCustomer from a `customers` row, preferring the caller-supplied `snapshotPhone` (fresher, from Asaas) over the stored one — both normalized here so callers never have to remember to. */
export function toBillingCustomer(row: CustomerRow | null | undefined, snapshotPhone: string | null): BillingCustomer | null {
  if (!row) return null;
  return { id: row.id, status: row.status, phone: normalizePhone(snapshotPhone) ?? normalizePhone(row.phone), name: row.responsible_name ?? row.office_name ?? null };
}
export type CollectionPreview = { payment: BillingPayment; customer: BillingCustomer | null; days: number | null; stage: string | null; text: string; parameters: Record<string, string>; language: string; blocked: string | null; approval?: string };
export function previewCollection(payment: BillingPayment, customer: BillingCustomer | null, templates: BillingTemplate[], today: string, rules: CollectionRule[] = DEFAULT_COLLECTION_SETTINGS.rules, calendar?: CollectionCalendar): CollectionPreview {
  payment = canonicalBillingPayment(payment);
  const phone = normalizePhone(customer?.phone);
  const days = payment.due_date ? dayDistance(today, payment.due_date) : NaN;
  const stage = collectionSchedule(payment.due_date, today, rules, calendar).stage;
  const row: CollectionPreview = { payment, customer, days: Number.isFinite(days) ? days : null, stage, text: "", parameters: {}, language: "pt_BR", blocked: null };
  if (!["PENDING", "OVERDUE"].includes(payment.status)) row.blocked = "Cobrança não está em aberto";
  else if (!customer) row.blocked = "Cliente não encontrado na base";
  else if (customer.status !== "ACTIVE") row.blocked = "Cliente sem status Ativo confirmado";
  else if (!stage) row.blocked = "Sem envio hoje";
  else if (!phone) row.blocked = "Telefone não cadastrado";
  const template = templates.find(t => t.name === stage && t.status === "APPROVED" && t.instance_id === FINANCIAL_INSTANCE && t.language === "pt_BR");
  if (row.blocked) return row;
  if (!template) return { ...row, blocked: "Template aprovado não encontrado no número financeiro" };
  const values: Record<string, string> = { "1": customer?.name ?? payment.contact_name ?? "", "2": payment.due_date?.split("-").reverse().join("/") ?? "", "3": payment.invoice_url ?? "" };
  const texts: string[] = [];
  for (const component of template.components) {
    const kind = component.type.toLowerCase();
    if (!["body", "header", "footer"].includes(kind) || (component.format && component.format !== "TEXT")) return { ...row, blocked: "Template exige configuração de mídia ou botões" };
    const text = component.text ?? "";
    let missing = false;
    const rendered = text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, index: string) => {
      if (!values[index] || (kind !== "body")) { missing = true; return ""; }
      row.parameters[`body_${index}`] = values[index]; return values[index];
    });
    if (missing || rendered.includes("{{")) return { ...row, blocked: "Variáveis do template precisam de revisão" };
    texts.push(rendered);
  }
  if (!texts.some(Boolean)) return { ...row, blocked: "Template sem texto para aprovação" };
  return { ...row, text: texts.join("\n\n"), language: template.language };
}
```

Note: `BillingContact` (tipo antigo) permanece no arquivo intocado — ainda usado por `lib/collection-schedule-server.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/collection-policy.test.mjs`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add lib/collection-policy.ts tests/collection-policy.test.mjs
git commit -m "collections: previewCollection resolves eligibility from our own customers, not Chat Jurídico"
```

---

### Task 4: `app/api/collections/route.ts` — GET e POST usando nossa base + Asaas direto

**Files:**
- Modify: `app/api/collections/route.ts`
- Test: `tests/collection-route.test.mjs` (novo)

**Interfaces:**
- Consumes: `previewCollection`, `toBillingCustomer`, `CustomerRow`, `FINANCIAL_INSTANCE` (Task 3, `lib/collection-policy.ts`); `fetchAsaasCustomer`, `asaasRequest`, `AsaasPayment` (`lib/asaas.ts`, já existentes); `supabaseRequest` (`lib/supabase-server.ts`, já existente).
- Produces: mesmo contrato HTTP de antes (`GET ?reportId=` → `{today, rows}`; `POST {paymentId, approval, approved}` → `{ok:true}` ou erro), só que `paymentId` agora é o id do pagamento no **Asaas** (`pay_xxx`), não mais um UUID do Chat Jurídico.

- [ ] **Step 1: Write the failing test**

Criar `tests/collection-route.test.mjs`:

```js
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, cacheDir: "node_modules/.vite-tests/collection-route", resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());

function mockFetch(handlers) {
  return async (input, options) => {
    const url = new URL(input);
    for (const [match, handler] of handlers) {
      if (typeof match === "string" ? url.pathname.startsWith(match) : match.test(url.pathname)) return handler(url, options);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test("GET /api/collections resolves eligibility from our customers table, not Chat Jurídico payments", async () => {
  const { GET } = await vite.ssrLoadModule("/app/api/collections/route.ts");
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const { collectionToday } = await vite.ssrLoadModule("/lib/collection-policy.ts");
  const today = collectionToday(); // real wall-clock "today" in America/Sao_Paulo — the route compares report_date against this, so the mock report must use the same value rather than a hardcoded date that would only match by coincidence.
  const previousFetch = globalThis.fetch;
  const previous = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "test", INTEGRATIONS_ENCRYPTION_KEY: "a1".repeat(32) });
  const tenant = { id: "tenant-a", legacy: false };
  try {
    globalThis.fetch = mockFetch([
      [/\/rest\/v1\/collection_reports$/, () => Response.json([{ id: "report-1", mode: "DAILY", report_date: today, status: "COMPLETE", rule_config: { rules: [] } }])],
      [/\/rest\/v1\/collection_report_rows$/, () => Response.json([{ id: "row-1", report_id: "report-1", asaas_payment_id: "pay_active", snapshot: { payment_id: "pay_active", customer_id: "cus_active", name: "Cliente Ativo", email: "a@a.com", phone: "11940777545", status: "OVERDUE", value: 100, due_date: today, description: "", billing_type: "PIX", days: 0, stage: null, trigger: null, nominal: null, effective: null, invoice_url: "https://asaas.com/i/x", bankslip_url: null, pix_payload: null, pix_image: null, pix_expiration: null, warnings: [] } }, { id: "row-2", report_id: "report-1", asaas_payment_id: "pay_no_customer", snapshot: { payment_id: "pay_no_customer", customer_id: "cus_unknown", name: "Sem Base", email: "b@b.com", phone: "11988887777", status: "OVERDUE", value: 50, due_date: today, description: "", billing_type: "PIX", days: 0, stage: null, trigger: null, nominal: null, effective: null, invoice_url: "https://asaas.com/i/y", bankslip_url: null, pix_payload: null, pix_image: null, pix_expiration: null, warnings: [] } }])],
      [/\/rest\/v1\/customers$/, () => Response.json([{ id: "db-1", asaas_customer_id: "cus_active", status: "ACTIVE", phone: "(11) 94077-7545", responsible_name: "Ana", office_name: "Escritório Ana" }])],
      [/\/rest\/v1\/collection_settings/, () => Response.json([])],
      ["https://api.jur.chat/v1/templates", () => Response.json({ data: [{ name: "cobranca_d_000", status: "APPROVED", instance_id: "46a8a400-70a2-43fd-bfeb-1e286871711b", language: "pt_BR", components: [{ type: "BODY", text: "Olá {{1}}, vencimento {{2}}: {{3}}" }] }] })],
      [/\/rest\/v1\/audit_events$/, () => Response.json([])],
    ]);
    const response = await withWebhookTenant(tenant, () => GET(new Request("http://localhost/api/collections?reportId=report-1")));
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    const active = data.rows.find(r => r.payment.asaas_payment_id === "pay_active");
    const missing = data.rows.find(r => r.payment.asaas_payment_id === "pay_no_customer");
    // Whether "today" happens to be a business day (and so whether a stage/template
    // actually renders) is a pre-existing, separately-tested concern of
    // collectionSchedule/previewCollection (see tests/collection-policy.test.mjs) —
    // this test only cares that customer matching picked the right base, so it must
    // not depend on the real run date being a business day.
    assert.notEqual(active.blocked, "Cliente não encontrado na base", active.blocked ?? "");
    if (active.blocked === null) assert.equal(active.text.includes("Ana"), true);
    assert.equal(missing.blocked, "Cliente não encontrado na base");
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/collection-route.test.mjs`
Expected: FAIL — hoje o `GET` ainda tenta casar por pagamento do Chat Jurídico (`chatList("/v1/payments?status=...")`), então o mock não cobre essas chamadas e o teste quebra (ou o `active.blocked` vem preenchido com o motivo antigo).

- [ ] **Step 3: Rewrite `app/api/collections/route.ts`**

Substituir o arquivo inteiro por:

```ts
import { dispatchCollection } from "@/lib/collection-dispatch";
import { rulesForCustomer } from "@/lib/collection-rules";
import { readCollectionSettings } from "@/lib/collection-settings-server";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { requireUser, sameOrigin } from "@/lib/auth-server";
import { currentTenant } from "@/lib/tenant-server";
import { supabaseRequest } from "@/lib/supabase-server";
import { readCollectionReport, reportRows } from "@/lib/collection-reports-server";
import { asaasRequest, fetchAsaasCustomer, type AsaasPayment } from "@/lib/asaas";
import { chatRequest } from "@/lib/chat-juridico-server";
import { canonicalBillingPayment, collectionToday, toBillingCustomer, FINANCIAL_INSTANCE, previewCollection, type BillingTemplate, type CollectionPreview, type CustomerRow } from "@/lib/collection-policy";

function approval(row: CollectionPreview, tenant: string, today: string) {
  const secret = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!secret) throw new Error("Proteção de integrações não configurada.");
  return createHmac("sha256", secret).update(JSON.stringify({ tenant, today, row })).digest("hex");
}
async function templates() {
  const result = await chatRequest<{ data: BillingTemplate[] }>(`/v1/templates?instance_id=${FINANCIAL_INSTANCE}&status=APPROVED`);
  if (!Array.isArray(result.data)) throw new Error("Resposta de templates inválida.");
  return result.data;
}
export async function GET(request: Request) {
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    const reportId = new URL(request.url).searchParams.get("reportId");
    if (!reportId || !/^[a-f0-9-]{36}$/i.test(reportId)) throw new Error("Gere e selecione um relatório do Asaas primeiro.");
    const report = await readCollectionReport(reportId);
    const tenant = await currentTenant(); const today = collectionToday();
    const settings = await readCollectionSettings();
    if (report.mode === "ALL") throw new Error("Use um relatório diário ou de cobranças em aberto para preparar mensagens.");
    if (report.status !== "COMPLETE" || report.report_date !== today) throw new Error("Prepare as mensagens a partir de um relatório concluído de hoje.");
    const snapshots = (await reportRows(reportId)).map(row => row.snapshot).filter(row => ["PENDING", "OVERDUE"].includes(row.status));
    if (!snapshots.length) {
      await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { id: randomUUID(), entity_type: "collection_review", entity_id: reportId, action: "PREPARED", after_json: { today, rows: [] } } });
      return Response.json({ today, rows: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const available = await templates();
    const customerIds = [...new Set(snapshots.map(row => row.customer_id))];
    const customers = await supabaseRequest<CustomerRow[]>(`/rest/v1/customers?select=id,asaas_customer_id,status,phone,responsible_name,office_name&asaas_customer_id=in.(${customerIds.map(id => `"${id}"`).join(",")})`);
    const customerByAsaasId = new Map(customers.map(row => [row.asaas_customer_id, row]));
    const rows = snapshots.map(snapshot => {
      const p = canonicalBillingPayment({ id: snapshot.payment_id, asaas_payment_id: snapshot.payment_id, contact_id: null, contact_name: snapshot.name, chat_id: null, due_date: snapshot.due_date, value: snapshot.value, status: snapshot.status, invoice_url: snapshot.invoice_url });
      const customer = toBillingCustomer(customerByAsaasId.get(snapshot.customer_id), snapshot.phone);
      return previewCollection(p, customer, available, today, rulesForCustomer(settings, snapshot.customer_id));
    });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { id: randomUUID(), entity_type: "collection_review", entity_id: reportId, action: "PREPARED", after_json: { today, rows } } });
    return Response.json({ today, rows: rows.map(row => ({ ...row, approval: row.blocked ? undefined : approval(row, tenant.id, today) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível preparar a régua." }, { status: 400 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  const body = await request.json().catch(() => null);
  if (body?.approved !== true || typeof body.paymentId !== "string" || !/^pay_[a-zA-Z0-9]+$/.test(body.paymentId) || typeof body.approval !== "string" || !/^[a-f0-9]{64}$/.test(body.approval)) return Response.json({ error: "Aprove uma prévia válida antes de enviar." }, { status: 400 });
  try {
    const tenant = await currentTenant(); const today = collectionToday();
    const settings = await readCollectionSettings();
    const source = await asaasRequest<AsaasPayment & { invoiceUrl?: string }>(`/payments/${encodeURIComponent(body.paymentId)}`);
    const payer = await fetchAsaasCustomer(source.customer);
    const payment = canonicalBillingPayment({ id: body.paymentId, asaas_payment_id: body.paymentId, contact_id: null, contact_name: payer.name ?? "Cliente não identificado", chat_id: null, due_date: source.dueDate ?? null, value: Number(source.value), status: source.status, invoice_url: source.invoiceUrl ?? null });
    const [customerRow] = await supabaseRequest<CustomerRow[]>(`/rest/v1/customers?select=id,asaas_customer_id,status,phone,responsible_name,office_name&asaas_customer_id=eq.${encodeURIComponent(source.customer)}`);
    const customer = toBillingCustomer(customerRow, payer.mobilePhone ?? payer.phone ?? null);
    const row = previewCollection(payment, customer, await templates(), today, rulesForCustomer(settings, source.customer));
    if (row.blocked || !timingSafeEqual(Buffer.from(body.approval), Buffer.from(approval(row, tenant.id, today)))) return Response.json({ error: "Os dados mudaram ou a prévia expirou. Atualize a régua e revise novamente." }, { status: 409 });
    const result = await dispatchCollection(row, today);
    if (result.skipped) return Response.json({ error: "Esta etapa já possui uma tentativa registrada. Confira o histórico." }, { status: 409 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível enviar." }, { status: 400 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/collection-route.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full existing suite to catch regressions**

Run: `node --test tests/*.test.mjs`
Expected: PASS em tudo (o `tests/collection-policy.test.mjs` da Task 3 continua passando; nenhum outro teste referencia o `route.ts` antigo).

- [ ] **Step 6: Commit**

```bash
git add app/api/collections/route.ts tests/collection-route.test.mjs
git commit -m "collections: match report rows to our customers table instead of Chat Jurídico payments"
```

---

### Task 5: `dispatchCollection` resolve/cria o contato do Chat Jurídico pelo telefone

**Files:**
- Modify: `lib/collection-dispatch.ts`
- Test: `tests/collection-dispatch.test.mjs` (novo)

**Interfaces:**
- Consumes: `row.customer.phone` (já normalizado, Task 3/4), `chatRequest` (`lib/chat-juridico-server.ts`, já existente).
- Produces: `dispatchCollection(row: CollectionPreview, today: string): Promise<{ skipped: boolean }>` — mesma assinatura de antes.

- [ ] **Step 1: Write the failing test**

Criar `tests/collection-dispatch.test.mjs`:

```js
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, cacheDir: "node_modules/.vite-tests/collection-dispatch", resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());

function baseRow() {
  return {
    payment: { id: "pay_123", asaas_payment_id: "pay_123", contact_id: null, contact_name: "Ana", chat_id: null, due_date: "2026-09-08", value: 100, status: "OVERDUE", invoice_url: "https://asaas.com/i/x" },
    customer: { id: "db-1", status: "ACTIVE", phone: "5511940777545", name: "Ana" },
    days: 0, stage: "cobranca_d_000", text: "Olá Ana", parameters: { body_1: "Ana" }, language: "pt_BR", blocked: null,
  };
}

async function withEnv(run) {
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const { dispatchCollection } = await vite.ssrLoadModule("/lib/collection-dispatch.ts");
  const previous = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "test", INTEGRATIONS_ENCRYPTION_KEY: "a1".repeat(32) });
  try { await withWebhookTenant({ id: "tenant-a", legacy: false }, () => run(dispatchCollection)); }
  finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
}

test("reuses an existing WhatsApp contact found by phone", async () => {
  const previousFetch = globalThis.fetch;
  let createdContact = false;
  try {
    globalThis.fetch = async (input, options) => {
      const url = new URL(input);
      // chatRequest always sets `method` explicitly (defaults to "GET"), so options.method is never undefined here.
      if (url.host === "api.jur.chat" && url.pathname === "/v1/contacts" && options.method === "GET") return Response.json({ data: [{ id: "contact-existing", phone: "5511940777545", instance_id: "46a8a400-70a2-43fd-bfeb-1e286871711b", is_active: true, name: "Ana" }] });
      if (url.host === "api.jur.chat" && url.pathname === "/v1/contacts" && options.method === "POST") { createdContact = true; return Response.json({ data: { id: "contact-should-not-be-created" } }); }
      if (url.host === "api.jur.chat" && url.pathname === "/v1/conversations") return Response.json({ data: { id: "conv-1", instance_id: "46a8a400-70a2-43fd-bfeb-1e286871711b", contact_id: "contact-existing" } });
      if (url.host === "api.jur.chat" && url.pathname.startsWith("/v1/conversations/")) return Response.json({ data: { id: "message-1" } });
      if (url.pathname.endsWith("/audit_events")) return Response.json([]);
      throw new Error(`Unexpected fetch: ${url}`);
    };
    await withEnv(async dispatchCollection => {
      const result = await dispatchCollection(baseRow(), "2026-09-08");
      assert.equal(result.skipped, false);
    });
    assert.equal(createdContact, false);
  } finally { globalThis.fetch = previousFetch; }
});

test("creates a new WhatsApp contact when none exists for that phone on the financial instance", async () => {
  const previousFetch = globalThis.fetch;
  let created = false;
  try {
    globalThis.fetch = async (input, options) => {
      const url = new URL(input);
      if (url.host === "api.jur.chat" && url.pathname === "/v1/contacts" && options.method === "GET") return Response.json({ data: [] });
      if (url.host === "api.jur.chat" && url.pathname === "/v1/contacts" && options.method === "POST") { created = true; return Response.json({ data: { id: "contact-new", phone: "5511940777545", instance_id: "46a8a400-70a2-43fd-bfeb-1e286871711b", is_active: true, name: "Ana" } }); }
      if (url.host === "api.jur.chat" && url.pathname === "/v1/conversations") return Response.json({ data: { id: "conv-2", instance_id: "46a8a400-70a2-43fd-bfeb-1e286871711b", contact_id: "contact-new" } });
      if (url.host === "api.jur.chat" && url.pathname.startsWith("/v1/conversations/")) return Response.json({ data: { id: "message-2" } });
      if (url.pathname.endsWith("/audit_events")) return Response.json([]);
      throw new Error(`Unexpected fetch: ${url}`);
    };
    await withEnv(async dispatchCollection => {
      const result = await dispatchCollection(baseRow(), "2026-09-08");
      assert.equal(result.skipped, false);
    });
    assert.equal(created, true);
  } finally { globalThis.fetch = previousFetch; }
});

test("refuses to dispatch a blocked or phoneless preview", async () => {
  await withEnv(async dispatchCollection => {
    await assert.rejects(() => dispatchCollection({ ...baseRow(), blocked: "Cliente sem status Ativo confirmado" }, "2026-09-08"));
    await assert.rejects(() => dispatchCollection({ ...baseRow(), customer: { ...baseRow().customer, phone: null } }, "2026-09-08"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/collection-dispatch.test.mjs`
Expected: FAIL — `dispatchCollection` hoje usa `row.payment.contact_id` (sempre `null` nos dados de teste) direto em `/v1/conversations`, nunca busca/cria contato por telefone; e não valida `customer`/telefone ausente.

- [ ] **Step 3: Rewrite `lib/collection-dispatch.ts`**

```ts
import { createHash } from 'node:crypto';
import { currentTenant } from './tenant-server';
import { supabaseRequest } from './supabase-server';
import { chatRequest } from './chat-juridico-server';
import { FINANCIAL_INSTANCE, type BillingContact, type CollectionPreview } from './collection-policy';

/** Finds the WhatsApp contact for `phone` on the financial instance, creating one if none exists — the same "resolve, creating what's missing" behavior the `enviar_para_numero` tool provides, done here directly via REST since dispatch runs server-side, not through that tool. */
async function resolveChatContact(phone: string, name: string): Promise<string> {
  const { data: matches } = await chatRequest<{ data: BillingContact[] }>(`/v1/contacts?phone=${encodeURIComponent(phone)}`);
  const existing = matches.find(contact => contact.instance_id === FINANCIAL_INSTANCE);
  if (existing) return existing.id;
  const { data: created } = await chatRequest<{ data: BillingContact }>("/v1/contacts", { method: "POST", body: { name, phone, instance_id: FINANCIAL_INSTANCE } });
  return created.id;
}

/** Shared atomic claim: manual and scheduled execution cannot repeat the same payment/day/stage. */
export async function dispatchCollection(row: CollectionPreview, today: string) {
  if (row.blocked || !row.stage || !row.customer?.phone) throw new Error('Cobrança não apta para envio.');
  const tenant = await currentTenant(), payment = row.payment, customer = row.customer;
  let attemptId: string | null = null;
  try {
    const hash = createHash("sha256").update(`${tenant.id}:${payment.id}:${today}:${row.stage}`).digest("hex").slice(0, 32);
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
    const existing = await supabaseRequest<{ id: string }[]>(`/rest/v1/audit_events?id=eq.${id}&select=id`);
    if (existing.length) return { skipped: true };
    // The unique ID claims this payment/day atomically, including concurrent approvals.
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { id, entity_type: "collection_send", entity_id: payment.id, action: "SENDING", after_json: { ...row, date: today } } });
    attemptId = id;
    const contactId = await resolveChatContact(customer.phone, customer.name ?? payment.contact_name ?? "Cliente");
    const { data: conversation } = await chatRequest<{ data: { id: string; instance_id: string; contact_id: string } }>("/v1/conversations", { method: "POST", idempotencyKey: `conversation-${id}`, body: { contact_id: contactId, instance_id: FINANCIAL_INSTANCE } });
    if (conversation.instance_id !== FINANCIAL_INSTANCE || conversation.contact_id !== contactId) throw new Error("A conversa retornada não corresponde ao contato e número financeiro aprovados.");
    await chatRequest(`/v1/conversations/${encodeURIComponent(conversation.id)}/messages`, { method: "POST", idempotencyKey: `collection-${id}`, body: { type: "template", instance_id: FINANCIAL_INSTANCE, template: { name: row.stage, language: row.language, parameters: row.parameters } } });
    await supabaseRequest(`/rest/v1/audit_events?id=eq.${id}`, { method: "PATCH", body: { action: "SENT" } });
    return { skipped: false };
  } catch (error) {
    if (attemptId) {
      await supabaseRequest(`/rest/v1/audit_events?id=eq.${attemptId}`, { method: 'PATCH', body: { action: 'REVIEW_REQUIRED' } }).catch(() => null);
      throw new Error('Resultado do envio incerto. Confira o histórico e a conversa antes de continuar.');
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/collection-dispatch.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/collection-dispatch.ts tests/collection-dispatch.test.mjs
git commit -m "collections: resolve/create the WhatsApp contact by phone at dispatch time"
```

---

### Task 6: `lib/collection-schedule-server.ts` — programação automática usando nossa base

A Programação automática (aba "Programação", `POST /api/collections/schedule {action:"tick"}`) tem o mesmo problema do fluxo manual: `queueForToday` cruza pagamentos elegíveis (já calculados da nossa própria base Asaas sincronizada) com `chatList("/v1/payments?...")` do Chat Jurídico só para achar um `contact_id` — e como isso nunca casa, a fila fica sempre vazia e o job "conclui" com 0 enviados, todo dia, silenciosamente.

**Files:**
- Modify: `lib/collection-schedule-server.ts`
- Modify: `tests/scheduling.test.mjs`

**Interfaces:**
- Consumes: `toBillingCustomer`, `CustomerRow`, `previewCollection` (Task 3, `lib/collection-policy.ts`); `fetchAsaasCustomer`, `asaasRequest` (`lib/asaas.ts`, já existentes); `dispatchCollection` (Task 5, mesma assinatura).
- Produces: `queueForToday`/`advanceSchedule` continuam com a mesma assinatura pública (`advanceSchedule(): Promise<{active: boolean}>`), mas `job.payment_ids` agora guarda **ids de pagamento do Asaas** (`pay_xxx`), não mais UUIDs de pagamento do Chat Jurídico.

- [ ] **Step 1: Write the failing test**

Em `tests/scheduling.test.mjs`, dois ajustes:

1. A linha 49 (`dispatchCollection({ blocked: null, stage: 'due', payment: { id: 'payment' }, contact: { instance_id: FINANCIAL_INSTANCE } }, '2026-09-08')`) usa `contact`, que não existe mais em `CollectionPreview` (Task 3) — e sem um `customer.phone` válido, `dispatchCollection` (Task 5) rejeita antes mesmo de chegar na claim idempotente que esse teste quer verificar. Trocar por:

```js
dispatchCollection({ blocked: null, stage: 'due', payment: { id: 'payment' }, customer: { id: 'c', status: 'ACTIVE', phone: '5511999999999', name: 'Ana' } }, '2026-09-08')
```

2. Substituir o teste `'scheduled worker rechecks Asaas and skips a payment settled after the queue was built'` inteiro por:

```js
test('scheduled worker builds the queue straight from our own Asaas base, with no Chat Jurídico payment/contact lookup', async () => {
  const { advanceSchedule } = await vite.ssrLoadModule('/lib/collection-schedule-server.ts');
  const { collectionToday } = await vite.ssrLoadModule('/lib/collection-policy.ts');
  const original = globalThis.fetch, previous = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test' });
  const today = collectionToday();
  let finalJob;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input), table = url.pathname.split('/').at(-1);
    if (url.host === 'api.jur.chat') throw new Error(`Chat Jurídico não deveria ser consultado para montar a fila: ${url}`);
    if (table === 'collection_schedule') return Response.json([{ config: { enabled: true, time: '00:00', saturday: true, sunday: true, holidays: true } }]);
    if (table === 'collection_settings') return Response.json([]);
    if (table === 'asaas_base_sync') return Response.json([{ active_generation: 'gen-1' }]);
    if (table === 'asaas_base_payments') return Response.json([{ external_id: 'pay_due_today', payload: { id: 'pay_due_today', customer: 'cus_x', status: 'OVERDUE', dueDate: today, value: 100 } }]);
    assert.equal(table, 'collection_schedule_jobs');
    if (options.method === 'PATCH' && url.searchParams.has('lease_until')) return Response.json([{ payment_ids: null, cursor: 0, sent: 0, skipped: 0 }]);
    if (options.method === 'PATCH') finalJob = JSON.parse(options.body);
    return Response.json([]);
  };
  try {
    const result = await withWebhookTenant({ id: 'tenant', legacy: true }, () => advanceSchedule());
    assert.equal(finalJob.payment_ids.length, 1);
    assert.equal(finalJob.payment_ids[0], 'pay_due_today'); // Asaas id directly, not a Chat Jurídico UUID
    assert.equal(result.active, true);
  } finally { globalThis.fetch = original; for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
});

test('scheduled worker resolves eligibility from our own customers table and skips an already-settled charge', async () => {
  const { advanceSchedule } = await vite.ssrLoadModule('/lib/collection-schedule-server.ts');
  const { collectionToday } = await vite.ssrLoadModule('/lib/collection-policy.ts');
  const { sealSecret } = await vite.ssrLoadModule('/lib/integrations-server.ts');
  const original = globalThis.fetch, previous = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test', INTEGRATIONS_ENCRYPTION_KEY: 'a'.repeat(64), ASAAS_API_KEY: 'test', ASAAS_BASE_URL: 'https://api.asaas.com/v3' });
  const encrypted = sealSecret('mock-key', 'tenant', 'chat-juridico');
  const today = collectionToday();
  let finalJob;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input), table = url.pathname.split('/').at(-1);
    if (url.host === 'api.asaas.com') return Response.json(url.pathname.includes('/payments/') ? { id: 'pay', customer: 'cus', status: 'RECEIVED', value: 100, dueDate: today, invoiceUrl: 'https://example.com/i' } : { name: 'Ana', mobilePhone: '11999999999' });
    if (url.host === 'api.jur.chat') { assert.equal(url.pathname, '/v1/templates'); return Response.json({ data: [] }); }
    // getAsaasConfig()/chatRequest() both check for a stored integration before falling back — asaas has none here (falls back to the legacy ASAAS_API_KEY env var), chat-juridico must have one (no such fallback exists for it).
    if (table === 'nexo_integrations') return Response.json(url.searchParams.get('provider') === 'eq.chat-juridico' ? [{ encrypted_key: encrypted, tenant_id: 'tenant' }] : []);
    if (table === 'collection_schedule') return Response.json([{ config: { enabled: true, time: '00:00', saturday: true, sunday: true, holidays: true } }]);
    if (table === 'collection_settings') return Response.json([]);
    if (table === 'customers') return Response.json([]); // no match needed: the payment is already RECEIVED, blocked before customer matters
    assert.equal(table, 'collection_schedule_jobs');
    if (options.method === 'PATCH' && url.searchParams.has('lease_until')) return Response.json([{ payment_ids: ['pay'], cursor: 0, sent: 0, skipped: 0 }]);
    if (options.method === 'PATCH') finalJob = JSON.parse(options.body);
    return Response.json([]);
  };
  try {
    assert.deepEqual(await withWebhookTenant({ id: 'tenant', legacy: true }, () => advanceSchedule()), { active: false });
    assert.equal(finalJob.status, 'COMPLETE'); assert.equal(finalJob.sent, 0); assert.equal(finalJob.skipped, 1);
  } finally { globalThis.fetch = original; for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','INTEGRATIONS_ENCRYPTION_KEY','ASAAS_API_KEY','ASAAS_BASE_URL']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scheduling.test.mjs`
Expected: FAIL — hoje `queueForToday` ainda chama `chatList("/v1/payments?...")` (o teste novo derruba com "Chat Jurídico não deveria ser consultado"), e o processamento por item ainda busca `/v1/payments/{uuid}` e `/v1/contacts/{id}` no Chat Jurídico em vez da nossa base.

- [ ] **Step 3: Rewrite `lib/collection-schedule-server.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { supabaseRequest } from './supabase-server';
import { DEFAULT_SCHEDULE, scheduleDue, type CollectionScheduleConfig } from './collection-schedule';
import { readCollectionSettings } from './collection-settings-server';
import { rulesForCustomer } from './collection-rules';
import { canonicalBillingPayment, collectionSchedule, collectionToday, FINANCIAL_INSTANCE, previewCollection, toBillingCustomer, type BillingTemplate, type CustomerRow } from './collection-policy';
import { chatRequest } from './chat-juridico-server';
import { asaasRequest, fetchAsaasCustomer, type AsaasPayment } from './asaas';
import { dispatchCollection } from './collection-dispatch';
export type ScheduleJob = { run_date: string; status: 'RUNNING' | 'COMPLETE' | 'REVIEW_REQUIRED'; payment_ids: string[] | null; cursor: number; sent: number; skipped: number; error: string | null; updated_at: string };
export async function readSchedule() {
  const [row] = await supabaseRequest<{ config: CollectionScheduleConfig }[]>('/rest/v1/collection_schedule?select=config&limit=1');
  return row?.config ?? { ...DEFAULT_SCHEDULE };
}
/** Every eligible Asaas payment id (stage due today) from our own synced base — no Chat Jurídico lookup needed, unlike before: eligibility is entirely decided later, per item, against our own `customers` table (see the per-item step in `advanceSchedule`). */
async function queueForToday(config: CollectionScheduleConfig, today: string) {
  const [state] = await supabaseRequest<{ active_generation: string | null }[]>('/rest/v1/asaas_base_sync?select=active_generation&limit=1');
  if (!state?.active_generation) throw new Error('Conclua a sincronização da base Asaas antes de programar envios.');
  const settings = await readCollectionSettings();
  const eligible = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const rows = await supabaseRequest<{ external_id: string; payload: AsaasPayment }[]>(`/rest/v1/asaas_base_payments?select=external_id,payload&generation=eq.${state.active_generation}&order=external_id&limit=1000&offset=${offset}`);
    for (const row of rows) if (['PENDING','OVERDUE'].includes(row.payload.status) && collectionSchedule(row.payload.dueDate ?? null, today, rulesForCustomer(settings, row.payload.customer), config).stage) eligible.add(row.external_id);
    if (rows.length < 1000) break;
  }
  return [...eligible];
}
/** One leased step per request; no detached work after the response. */
export async function advanceSchedule() {
  const config = await readSchedule();
  if (!scheduleDue(config)) return { active: false };
  const today = collectionToday(), now = new Date(), token = randomUUID();
  await supabaseRequest('/rest/v1/collection_schedule_jobs?on_conflict=tenant_id,run_date', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { run_date: today, lease_until: now.toISOString() } });
  const [job] = await supabaseRequest<ScheduleJob[]>(`/rest/v1/collection_schedule_jobs?run_date=eq.${today}&status=eq.RUNNING&lease_until=lte.${encodeURIComponent(now.toISOString())}`, { method: 'PATCH', prefer: 'return=representation', body: { lease_token: token, lease_until: new Date(now.getTime() + 300000).toISOString(), updated_at: now.toISOString() } });
  if (!job) return { active: false };
  const path = `/rest/v1/collection_schedule_jobs?run_date=eq.${today}&lease_token=eq.${token}`;
  try {
    if (!job.payment_ids) {
      const ids = await queueForToday(config, today);
      await supabaseRequest(path, { method: 'PATCH', body: { payment_ids: ids, status: ids.length ? 'RUNNING' : 'COMPLETE', lease_until: new Date().toISOString(), updated_at: new Date().toISOString() } });
      return { active: ids.length > 0 };
    }
    const paymentId = job.payment_ids[job.cursor];
    let skipped = true;
    if (paymentId) {
      const settings = await readCollectionSettings();
      const source = await asaasRequest<AsaasPayment & { invoiceUrl?: string; deleted?: boolean }>(`/payments/${encodeURIComponent(paymentId)}`);
      const payer = await fetchAsaasCustomer(source.customer);
      const payment = canonicalBillingPayment({ id: paymentId, asaas_payment_id: paymentId, contact_id: null, contact_name: payer.name ?? 'Cliente não identificado', chat_id: null, due_date: source.dueDate ?? null, value: Number(source.value), status: source.deleted ? 'DELETED' : source.status, invoice_url: source.invoiceUrl ?? null });
      const [customerRow] = await supabaseRequest<CustomerRow[]>(`/rest/v1/customers?select=id,asaas_customer_id,status,phone,responsible_name,office_name&asaas_customer_id=eq.${encodeURIComponent(source.customer)}`);
      const customer = toBillingCustomer(customerRow, payer.mobilePhone ?? payer.phone ?? null);
      const { data: templates } = await chatRequest<{ data: BillingTemplate[] }>(`/v1/templates?instance_id=${FINANCIAL_INSTANCE}&status=APPROVED`);
      const row = previewCollection(payment, customer, templates, today, rulesForCustomer(settings, source.customer), config);
      // Re-check persisted authorization immediately before each outbound message.
      const latest = await readSchedule();
      if (!scheduleDue(latest) || collectionToday() !== today || JSON.stringify(latest) !== JSON.stringify(config)) {
        await supabaseRequest(path, { method: 'PATCH', body: { lease_until: new Date().toISOString() } });
        return { active: false };
      }
      if (!row.blocked) skipped = (await dispatchCollection(row, today)).skipped;
    }
    const cursor = job.cursor + 1, complete = cursor >= job.payment_ids.length;
    await supabaseRequest(path, { method: 'PATCH', body: { cursor, sent: job.sent + (skipped ? 0 : 1), skipped: job.skipped + (skipped ? 1 : 0), status: complete ? 'COMPLETE' : 'RUNNING', lease_until: new Date().toISOString(), updated_at: new Date().toISOString() } });
    return { active: !complete };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha na programação.';
    await supabaseRequest(path, { method: 'PATCH', body: { status: 'REVIEW_REQUIRED', error: message, updated_at: new Date().toISOString() } });
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scheduling.test.mjs`
Expected: PASS (todos os testes do arquivo, incluindo os que já existiam e não mudaram).

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `node --test tests/*.test.mjs`
Expected: PASS em tudo.

- [ ] **Step 6: Commit**

```bash
git add lib/collection-schedule-server.ts tests/scheduling.test.mjs
git commit -m "collections: scheduled dispatch also resolves eligibility from our own customers table"
```

---

### Task 7: Suíte completa, build e verificação manual contra dados reais

**Files:** nenhum arquivo novo — só verificação.

- [ ] **Step 1: Rodar a suíte inteira**

Run: `node --test tests/*.test.mjs`
Expected: todos os testes passam (o número total de testes deve ter crescido em relação ao início: +2 em `collection-policy.test.mjs` das Tasks 1 e 3, +1 novo arquivo na Task 4, +1 novo arquivo na Task 5, +1 em `scheduling.test.mjs` da Task 6).

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build completo sem erros de tipo, `/api/collections` listado nas rotas.

- [ ] **Step 3: Verificação manual contra o relatório real de hoje**

Reaproveitar a técnica de diagnóstico já usada na conversa (script temporário fora do repo, com `withWebhookTenant` + `ssrLoadModule` das funções internas, usando `.env` real) para chamar a nova lógica de `GET /api/collections` contra o `reportId` do relatório de hoje (`e39aa114-74d0-4b12-a2e8-97c28a5ddcf8` ou o mais recente `DAILY`/`OPEN` `COMPLETE` do dia) e conferir:
- Total de elegíveis bate com clientes `ACTIVE` + telefone válido no relatório de hoje (esperado, pós-backfill: próximo de 69 dos 90, os que batem com `customers.asaas_customer_id` e ficaram `ACTIVE`).
- Nenhuma linha aparece bloqueada com o motivo antigo "Pagamento do Asaas sem vínculo no Chat Jurídico" (esse motivo não existe mais no código).
- Motivos de bloqueio restantes fazem sentido (ex: `CANCELLED`, "Cliente não encontrado na base" para os ~15 sem match).

Nenhuma mensagem real é enviada nessa verificação — é só a etapa de prévia (`GET`), que já era somente leitura antes.

- [ ] **Step 4: Confirmar visualmente no painel (opcional, se houver acesso de navegador)**

Abrir a aba Cobranças → Relatórios → selecionar o relatório de hoje → "Preparar prévias do relatório" e conferir que "Prévias para aprovação · N" mostra um N > 0, com os textos renderizados corretamente (nome, valor, vencimento, link).

- [ ] **Step 5: Confirmar que a Programação automática não fica mais travada em 0**

Na aba Cobranças → Programação, com a programação **desativada** (não habilitar de verdade nesta verificação — isso realmente dispararia mensagens), conferir nos logs/no `collection_schedule_jobs` de um dia de teste anterior (se houver) que a lógica nova monta `payment_ids` com ids do Asaas (`pay_xxx`), não mais UUIDs. Se quiser testar `advanceSchedule()` de ponta a ponta com dados reais, faça isso apenas com a programação desativada (`scheduleDue` retorna `false` e a função nem chega a montar a fila) ou peça confirmação explícita antes de habilitar de verdade, já que isso despacha mensagens reais.
