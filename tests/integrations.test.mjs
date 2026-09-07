import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", cacheDir: "node_modules/.vite-tests/integrations", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());

test("Tally authenticates the configured form and isolates tenant submissions", async () => {
  const { sealSecret } = await vite.ssrLoadModule('/lib/integrations-server.ts');
  const { POST } = await vite.ssrLoadModule('/app/api/webhooks/tally/route.ts');
  const previousFetch=globalThis.fetch, previous={...process.env};
  process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test';process.env.INTEGRATIONS_ENCRYPTION_KEY='a1'.repeat(32);
  const tenant='11111111-1111-4111-8111-111111111111', secret='tally-test-secret';
  const encrypted=sealSecret(secret,tenant,'tally');const rows=[];
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input),table=url.pathname.split('/').at(-1);
    if(table==='nexo_integrations')return Response.json(url.searchParams.get('tenant_id')===`eq.${tenant}`?[{tenant_id:tenant,encrypted_key:encrypted,account_id:'2EWBOV'}]:[]);
    if(table==='nexo_tenants')return Response.json([{id:tenant,legacy:false}]);
    assert.equal(table,'connect_leads');assert.equal(url.searchParams.get('tenant_id'),`eq.${tenant}`);
    if(options.method==='POST'){const row=JSON.parse(options.body);assert.equal(row.tenant_id,tenant);rows.push(row);return Response.json([]);}
    return Response.json(rows);
  };
  const request=(form,signature=true,account=tenant)=>{
    const body=JSON.stringify({eventType:'FORM_RESPONSE',data:{formId:form,submissionId:'response-1',fields:[{label:'Nome completo',value:'Teste'}]}});
    return new Request(`http://localhost/api/webhooks/tally?account=${account}`,{method:'POST',body,headers:{'tally-signature':signature?createHmac('sha256',secret).update(body).digest('base64'):'wrong'}});
  };
  try {
    assert.equal((await POST(request('2EWBOV',false))).status,401);
    assert.equal((await POST(request('other'))).status,403);
    assert.equal((await POST(request('2EWBOV',true,'22222222-2222-4222-8222-222222222222'))).status,503);
    assert.equal(rows.length,0);
    assert.equal((await POST(request('2EWBOV'))).status,200);
    assert.equal((await (await POST(request('2EWBOV'))).json()).deduplicated,true);
    assert.equal(rows.length,1);
  } finally {
    globalThis.fetch=previousFetch;
    for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','INTEGRATIONS_ENCRYPTION_KEY']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
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
