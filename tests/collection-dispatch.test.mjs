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
    if (url.pathname === "/v1/conversations") return Response.json({ data: { id: "conversation", contact_id: "resolved", instance_id: target } }, { status: 201 });
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
