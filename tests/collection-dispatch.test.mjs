import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", root, configFile: false, cacheDir: "node_modules/.vite-tests/collection-dispatch-current", resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());

test("resolves a sibling contact into the chosen sender before sending", async () => {
  const { dispatchCollection } = await vite.ssrLoadModule("/lib/collection-dispatch.ts");
  const { sealSecret } = await vite.ssrLoadModule("/lib/integrations-server.ts");
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const previousFetch = globalThis.fetch;
  const previous = { ...process.env };
  const target = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  Object.assign(process.env, { SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "test", INTEGRATIONS_ENCRYPTION_KEY: "a1".repeat(32) });
  const encrypted = sealSecret("chat-key", "tenant", "chat-juridico");
  let messageSent = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.host === "db.invalid") {
      if (url.pathname === "/rest/v1/nexo_integrations") return Response.json([{ encrypted_key: encrypted, tenant_id: "tenant" }]);
      if (url.pathname === "/rest/v1/audit_events" && options.method === "GET") return Response.json([]);
      return Response.json([]);
    }
    assert.equal(url.host, "api.jur.chat");
    if (url.pathname === "/v1/instances") return Response.json({ data: [{ id: target, is_connected: true }] });
    if (url.pathname === "/v1/contacts" && options.method === "GET") return Response.json({ data: [{ id: "sibling", name: "Ana", phone: "5511999999999", instance_id: other, is_active: true }], pagination: { has_more: false } });
    if (url.pathname === "/v1/contacts" && options.method === "POST") return Response.json({ error: { code: "duplicate_resource", message: "already exists", status: 409 } }, { status: 409 });
    if (url.pathname === "/v1/conversations" && (!options.method || options.method === "GET")) return Response.json({ data: [], pagination: { has_more: false } });
    if (url.pathname === "/v1/conversations" && options.method === "POST") return Response.json({ data: { id: "conversation", contact_id: "resolved", instance_id: target } }, { status: 201 });
    if (url.pathname === "/v1/contacts/resolved") return Response.json({ data: { id: "resolved", name: "Ana", phone: "5511999999999", instance_id: target, is_active: true } });
    if (url.pathname === "/v1/conversations/conversation/messages") { messageSent = true; return Response.json({ data: { id: "message" } }, { status: 201 }); }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const row = { payment: { id: "pay_1", asaas_payment_id: "pay_1", contact_id: "customer", contact_name: "Ana", chat_id: null, due_date: "2026-09-08", value: 100, status: "OVERDUE", invoice_url: "https://asaas.invalid/i/1" }, contact: { id: "customer", name: "Ana", phone: "5511999999999", is_active: true, instance_id: null }, instance_id: target, days: 0, stage: "cobranca_d_000", text: "Olá Ana", parameters: { body_1: "Ana" }, language: "pt_BR", blocked: null };
  try {
    const result = await withWebhookTenant({ id: "tenant", legacy: false }, () => dispatchCollection(row, "2026-09-08"));
    assert.deepEqual(result, { skipped: false });
    assert.equal(messageSent, true);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("reuses a legacy conversation found through the Brazilian phone variant", async () => {
  const { dispatchCollection } = await vite.ssrLoadModule("/lib/collection-dispatch.ts");
  const { sealSecret } = await vite.ssrLoadModule("/lib/integrations-server.ts");
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const previousFetch = globalThis.fetch;
  const previous = { ...process.env };
  const target = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  Object.assign(process.env, { SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "test", INTEGRATIONS_ENCRYPTION_KEY: "a1".repeat(32) });
  const encrypted = sealSecret("chat-key", "tenant", "chat-juridico");
  let conversationCreated = false, contactCreated = false, messageSent = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.host === "db.invalid") {
      if (url.pathname === "/rest/v1/nexo_integrations") return Response.json([{ encrypted_key: encrypted, tenant_id: "tenant" }]);
      if (url.pathname === "/rest/v1/audit_events" && options.method === "GET") return Response.json([]);
      return Response.json([]);
    }
    if (url.pathname === "/v1/instances") return Response.json({ data: [{ id: target, is_connected: true }] });
    if (url.pathname === "/v1/conversations" && (!options.method || options.method === "GET")) {
      const found = url.searchParams.get("search") === "559881035049";
      return Response.json({ data: found ? [{ id: "legacy-conversation", contact_id: "legacy-contact", instance_id: target, phone: "559881035049" }] : [], pagination: { has_more: false } });
    }
    if (url.pathname === "/v1/conversations" && options.method === "POST") { conversationCreated = true; throw new Error("conversation must be reused"); }
    if (url.pathname === "/v1/contacts" && options.method === "POST") { contactCreated = true; throw new Error("contact must be reused"); }
    if (url.pathname === "/v1/contacts/legacy-contact") return Response.json({ data: { id: "legacy-contact", phone: "559881035049", instance_id: other, is_active: true } });
    if (url.pathname === "/v1/conversations/legacy-conversation/messages") { messageSent = true; return Response.json({ data: { id: "message" } }, { status: 201 }); }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const row = { payment: { id: "pay_variant", asaas_payment_id: "pay_variant", contact_id: null, contact_name: "Igor", chat_id: null, due_date: "2026-09-08", value: 100, status: "OVERDUE", invoice_url: "https://asaas.invalid/i/2" }, contact: { id: "customer", name: "Igor", phone: "5598981035049", is_active: true, instance_id: null }, instance_id: target, days: 1, stage: "cobranca_d_mais_01", text: "Olá Igor", parameters: { body_1: "Igor" }, language: "pt_BR", blocked: null };
  try {
    assert.deepEqual(await withWebhookTenant({ id: "tenant", legacy: false }, () => dispatchCollection(row, "2026-09-09")), { skipped: false });
    assert.equal(messageSent, true); assert.equal(conversationCreated, false); assert.equal(contactCreated, false);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("recovers the conversation when creation returns Resource already exists", async () => {
  const { dispatchCollection } = await vite.ssrLoadModule("/lib/collection-dispatch.ts");
  const { sealSecret } = await vite.ssrLoadModule("/lib/integrations-server.ts");
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const previousFetch = globalThis.fetch;
  const previous = { ...process.env };
  const target = "11111111-1111-4111-8111-111111111111";
  Object.assign(process.env, { SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "test", INTEGRATIONS_ENCRYPTION_KEY: "a1".repeat(32) });
  const encrypted = sealSecret("chat-key", "tenant", "chat-juridico");
  let creationAttempted = false, messageSent = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.host === "db.invalid") {
      if (url.pathname === "/rest/v1/nexo_integrations") return Response.json([{ encrypted_key: encrypted, tenant_id: "tenant" }]);
      if (url.pathname === "/rest/v1/audit_events" && options.method === "GET") return Response.json([]);
      return Response.json([]);
    }
    if (url.pathname === "/v1/instances") return Response.json({ data: [{ id: target, is_connected: true }] });
    if (url.pathname === "/v1/contacts" && (!options.method || options.method === "GET")) return Response.json({ data: [{ id: "contact", name: "Ana", phone: "5511999999999", instance_id: target, is_active: true }], pagination: { has_more: false } });
    if (url.pathname === "/v1/conversations" && (!options.method || options.method === "GET")) return Response.json({ data: creationAttempted ? [{ id: "recovered", contact_id: "contact", instance_id: target, phone: "5511999999999" }] : [], pagination: { has_more: false } });
    if (url.pathname === "/v1/conversations" && options.method === "POST") { creationAttempted = true; return Response.json({ error: { code: "duplicate_resource", message: "Resource already exists", status: 409 } }, { status: 409 }); }
    if (url.pathname === "/v1/contacts/contact") return Response.json({ data: { id: "contact", phone: "5511999999999", instance_id: target, is_active: true } });
    if (url.pathname === "/v1/conversations/recovered/messages") { messageSent = true; return Response.json({ data: { id: "message" } }, { status: 201 }); }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const row = { payment: { id: "pay_conflict", asaas_payment_id: "pay_conflict", contact_id: null, contact_name: "Ana", chat_id: null, due_date: "2026-09-08", value: 100, status: "OVERDUE", invoice_url: "https://asaas.invalid/i/3" }, contact: { id: "customer", name: "Ana", phone: "5511999999999", is_active: true, instance_id: null }, instance_id: target, days: 1, stage: "cobranca_d_mais_01", text: "Olá Ana", parameters: { body_1: "Ana" }, language: "pt_BR", blocked: null };
  try {
    assert.deepEqual(await withWebhookTenant({ id: "tenant", legacy: false }, () => dispatchCollection(row, "2026-09-09")), { skipped: false });
    assert.equal(creationAttempted, true); assert.equal(messageSent, true);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
