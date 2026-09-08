// Read-only production verification. It never creates contacts, conversations or messages.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import assert from "node:assert/strict";
import { createServer } from "vite";

Object.assign(process.env, parseEnv(readFileSync(".env", "utf8")));
const root = process.cwd();
const vite = await createServer({ appType: "custom", root, configFile: false, cacheDir: "node_modules/.vite-tests/verify-chat-senders", resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { adminRequest, withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const [tenant] = await adminRequest("/rest/v1/nexo_tenants?reserved_email=eq.otavio%40chatjuridico.com.br&select=*");
  assert.ok(tenant?.owner_user_id);
  await withWebhookTenant(tenant, async () => {
    const { connectedChatInstances, chatRequest } = await vite.ssrLoadModule("/lib/chat-juridico-server.ts");
    const instances = await connectedChatInstances();
    const templateCounts = [];
    for (const instance of instances) {
      const result = await chatRequest(`/v1/templates?instance_id=${encodeURIComponent(instance.id)}&status=APPROVED`);
      templateCounts.push({ name: instance.name ?? "WhatsApp", phoneEnding: (instance.display_phone_number ?? instance.phone_id ?? "").replace(/\D/g, "").slice(-4), approvedTemplates: Array.isArray(result.data) ? result.data.length : 0 });
    }
    console.log(JSON.stringify({ connectedNumbers: instances.length, senders: templateCounts }));
  });
} finally { await vite.close(); }
