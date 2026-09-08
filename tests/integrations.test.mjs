import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", cacheDir: "node_modules/.vite-tests/integrations", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());

test("Tally sync pulls submissions via the API key, dedupes, and never touches a webhook", async () => {
  const { withWebhookTenant } = await vite.ssrLoadModule('/lib/tenant-server.ts');
  const { syncTallySubmissions, validateTallyKey } = await vite.ssrLoadModule('/lib/tally-sync.ts');
  const previousFetch = globalThis.fetch, previous = { ...process.env };
  process.env.SUPABASE_URL = 'https://example.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  const tenant = { id: '11111111-1111-4111-8111-111111111111', legacy: false };
  const questions = [{ id: 'q1', title: 'Nome completo' }];
  const submission = { id: 'sub-1', formId: '2EWBOV', submittedAt: '2026-09-05T00:00:00.000Z', responses: [{ questionId: 'q1', answer: 'Teste' }] };
  const rows = [];
  try {
    // A key that fails at Tally never touches Supabase and surfaces clearly.
    globalThis.fetch = async (url) => { assert.equal(new URL(url).host, 'api.tally.so'); return new Response('unauthorized', { status: 401 }); };
    await assert.rejects(() => validateTallyKey('bad-key', '2EWBOV'), /inv.lida/);

    globalThis.fetch = async (input, options) => {
      const url = new URL(input);
      if (url.host === 'api.tally.so') {
        assert.equal(url.pathname, '/forms/2EWBOV/submissions');
        assert.equal(options.headers.Authorization, 'Bearer real-key');
        return Response.json({ hasMore: false, questions, submissions: [submission] });
      }
      const table = url.pathname.split('/').at(-1);
      assert.equal(table, 'connect_leads'); assert.equal(url.searchParams.get('tenant_id'), `eq.${tenant.id}`);
      if (options?.method === 'POST') { const row = JSON.parse(options.body); assert.equal(row.tenant_id, tenant.id); rows.push(row); return Response.json([row]); }
      return Response.json(rows);
    };
    const first = await withWebhookTenant(tenant, () => syncTallySubmissions('real-key', '2EWBOV'));
    assert.deepEqual(first, { scanned: 1, imported: 1, skipped: 0 });
    assert.equal(rows[0].tally_submission_id, 'sub-1');
    assert.equal(rows[0].full_name, 'Teste');

    const second = await withWebhookTenant(tenant, () => syncTallySubmissions('real-key', '2EWBOV'));
    assert.deepEqual(second, { scanned: 1, imported: 0, skipped: 1 });
    assert.equal(rows.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

test("Chat Jurídico uses edge-compatible redirects and never follows credential redirects", async () => {
  const { chatRequest } = await vite.ssrLoadModule("/lib/chat-juridico-server.ts");
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(options.redirect, "manual");
      assert.equal(new URL(url).origin, "https://api.jur.chat");
      return new Response(null, { status: 302, headers: { Location: "https://other.example" } });
    };
    await assert.rejects(() => chatRequest("/v1/instances", { apiKey: "test-only" }), /redirecionamento/);
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ data: [] });
    assert.deepEqual(await chatRequest("/v1/instances", { apiKey: "test-only" }), { data: [] });
  } finally { globalThis.fetch = original; }
});

test("paid sync records payments without reactivating a manually disabled subscription", async () => {
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const { syncAsaasPayment } = await vite.ssrLoadModule("/lib/payment-sync.ts");
  const previousFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.invalid"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  try {
    for (const linked of [true, false]) {
      const mutations = [];
      globalThis.fetch = async (input, options) => {
        const url = new URL(input); const table = url.pathname.split("/").at(-1);
        if (options.method !== "GET") { mutations.push({ table, body: JSON.parse(options.body) }); return Response.json([]); }
        if (table === "customers") return Response.json([{ id: "customer", status: "ACTIVE" }]);
        if (table === "payment_links") return Response.json([{ id: "link", plans: { kind: "RECURRING" }, value: 100, billing_period: "MONTHLY" }]);
        if (table === "subscriptions") return Response.json([{ id: "subscription", customer_id: "customer", payment_link_id: "link", status: "CANCELLED", status_manually_set: true, asaas_subscription_id: "asaas-sub", billing_period: "MONTHLY", value: 100 }]);
        if (table === "payments") return Response.json([]);
        throw new Error(`Unexpected request ${table}`);
      };
      const result = await withWebhookTenant({ id: "tenant-a", legacy: false }, () => syncAsaasPayment({ id: "pay", customer: "asaas-customer", subscription: "asaas-sub", paymentLink: linked ? "asaas-link" : null, value: 100, status: "RECEIVED" }));
      assert.equal(result.subscriptionId, "subscription");
      assert.equal(mutations.filter(m => m.table === "subscriptions").length, 0);
      assert.equal(mutations.filter(m => m.table === "payments").length, 1);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test("API keys are encrypted and bound to their tenant and provider", async () => {
  const { sealSecret, openSecret } = await vite.ssrLoadModule("/lib/integrations-server.ts");
  const previous = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  process.env.INTEGRATIONS_ENCRYPTION_KEY = "a1".repeat(32);
  try {
    const encrypted = sealSecret("example-private-key", "tenant-a", "asaas");
    assert.ok(!encrypted.includes("example-private-key"));
    assert.notEqual(encrypted, sealSecret("example-private-key", "tenant-a", "asaas"));
    assert.equal(openSecret(encrypted, "tenant-a", "asaas"), "example-private-key");
    assert.throws(() => openSecret(encrypted, "tenant-b", "asaas"));
    assert.throws(() => openSecret(encrypted, "tenant-a", "chat-juridico"));
  } finally { if (previous === undefined) delete process.env.INTEGRATIONS_ENCRYPTION_KEY; else process.env.INTEGRATIONS_ENCRYPTION_KEY = previous; }
});

test("credential mutations reject foreign origins", async () => {
  const { sameOrigin } = await vite.ssrLoadModule("/lib/auth-server.ts");
  assert.equal(sameOrigin(new Request("https://nexo.example/api/integrations", { headers: { origin: "https://attacker.example" } })), false);
  assert.equal(sameOrigin(new Request("https://nexo.example/api/integrations")), false);
  assert.equal(sameOrigin(new Request("https://nexo.example/api/integrations", { headers: { origin: "https://nexo.example" } })), true);
});

test("scopes financial requests, overrides injected tenants and rejects external URLs", async () => {
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const { supabaseRequest } = await vite.ssrLoadModule("/lib/supabase-server.ts");
  const previousFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.invalid"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: new URL(url), options }); return Response.json([]); };
  try {
    await withWebhookTenant({ id: "tenant-a", legacy: false }, async () => {
      await supabaseRequest("/rest/v1/plans?tenant_id=eq.tenant-b", { method: "POST", body: { name: "Plano", tenant_id: "tenant-b" } });
      assert.equal(calls[0].url.searchParams.get("tenant_id"), "eq.tenant-a");
      assert.equal(JSON.parse(calls[0].options.body).tenant_id, "tenant-a");
      await assert.rejects(() => supabaseRequest("https://attacker.example/rest/v1/plans"));
      assert.equal(calls.length, 1);
    });
    await assert.rejects(() => supabaseRequest("/rest/v1/plans"));
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test("a new account never inherits the legacy user's Asaas key", async () => {
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const { getAsaasConfig } = await vite.ssrLoadModule("/lib/asaas.ts");
  const previousFetch = globalThis.fetch;
  const previous = { ...process.env };
  process.env.SUPABASE_URL = "https://example.invalid"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test"; process.env.ASAAS_API_KEY = "legacy-only";
  globalThis.fetch = async () => Response.json([]);
  try { assert.equal(await withWebhookTenant({ id: "new-tenant", legacy: false }, () => getAsaasConfig()), null); }
  finally { globalThis.fetch = previousFetch; for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ASAAS_API_KEY"]) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
});
