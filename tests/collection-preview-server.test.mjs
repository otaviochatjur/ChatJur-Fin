import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", root, configFile: false, cacheDir: "node_modules/.vite-tests/collection-preview-server", resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());

test("builds the selected recipient from Asaas and the internal customer status without reading Chat Jurídico payments", async () => {
  const { freshCollectionPreview } = await vite.ssrLoadModule("/lib/collection-preview-server.ts");
  const { collectionToday } = await vite.ssrLoadModule("/lib/collection-policy.ts");
  const { DEFAULT_COLLECTION_SETTINGS } = await vite.ssrLoadModule("/lib/collection-rules.ts");
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const originalFetch = globalThis.fetch;
  const previous = { ...process.env };
  const instanceId = "11111111-1111-4111-8111-111111111111";
  const today = collectionToday();
  Object.assign(process.env, { SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "test", ASAAS_API_KEY: "test", ASAAS_BASE_URL: "https://asaas.invalid/v3" });
  let status = "ACTIVE";
  let useAlias = false;
  globalThis.fetch = async input => {
    const url = new URL(input);
    assert.notEqual(url.host, "api.jur.chat", "Preparing a recipient must not read Chat Jurídico payments or contacts");
    if (url.pathname === "/rest/v1/nexo_integrations") return Response.json([]);
    if (url.pathname === "/rest/v1/customer_asaas_aliases") return Response.json([{ customer_id: "customer-1" }]);
    if (url.pathname === "/rest/v1/customers") {
      if (url.searchParams.has("asaas_customer_id") && useAlias) return Response.json([]);
      return Response.json([{ id: "customer-1", asaas_customer_id: "cus_primary", status, phone: "11911112222", responsible_name: "Ana", office_name: "Ana Sociedade" }]);
    }
    if (url.pathname === "/v3/payments/pay_selected") return Response.json({ id: "pay_selected", customer: "cus_1", status: "OVERDUE", value: 100, dueDate: today, invoiceUrl: "https://asaas.invalid/i/1" });
    if (url.pathname === "/v3/customers/cus_1") return Response.json({ id: "cus_1", name: "Nome Asaas", mobilePhone: "(11) 99999-9999" });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const template = { name: "cobranca_d_000", status: "APPROVED", instance_id: instanceId, language: "pt_BR", components: [{ type: "BODY", text: "Olá {{1}}: {{3}}" }] };
  try {
    const active = await withWebhookTenant({ id: "tenant", legacy: true }, () => freshCollectionPreview("pay_selected", instanceId, [template], DEFAULT_COLLECTION_SETTINGS, today));
    assert.equal(active.blocked, null);
    assert.equal(active.payment.id, "pay_selected");
    assert.equal(active.contact.phone, "5511999999999");
    assert.match(active.text, /Ana/);
    useAlias = true;
    const aliased = await withWebhookTenant({ id: "tenant", legacy: true }, () => freshCollectionPreview("pay_selected", instanceId, [template], DEFAULT_COLLECTION_SETTINGS, today));
    assert.equal(aliased.blocked, null);
    assert.equal(aliased.contact.id, "customer-1");
    status = "FROZEN";
    const frozen = await withWebhookTenant({ id: "tenant", legacy: true }, () => freshCollectionPreview("pay_selected", instanceId, [template], DEFAULT_COLLECTION_SETTINGS, today));
    assert.equal(frozen.blocked, "Cliente sem status Ativo confirmado");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
