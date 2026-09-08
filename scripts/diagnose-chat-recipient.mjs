// Read-only diagnostic for a collection recipient. Creates no contacts, conversations or messages.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import assert from "node:assert/strict";
import { createServer } from "vite";

Object.assign(process.env, parseEnv(readFileSync(".env", "utf8")));
const [phone, instanceId, templateName] = process.argv.slice(2);
const ensureContact = process.argv.includes("--ensure-contact");
const ensureConversation = process.argv.includes("--ensure-conversation");
assert.match(phone ?? "", /^\d{12,13}$/);
assert.match(instanceId ?? "", /^[a-f0-9-]{36}$/i);
assert.match(templateName ?? "", /^[a-z0-9_]{1,100}$/);

const root = process.cwd();
const vite = await createServer({ appType: "custom", root, configFile: false, cacheDir: "node_modules/.vite-tests/diagnose-chat-recipient", resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { adminRequest, withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const [tenant] = await adminRequest("/rest/v1/nexo_tenants?reserved_email=eq.otavio%40chatjuridico.com.br&select=*");
  assert.ok(tenant?.owner_user_id);
  await withWebhookTenant(tenant, async () => {
    const { chatList, chatRequest, connectedChatInstances, contactForChatInstance } = await vite.ssrLoadModule("/lib/chat-juridico-server.ts");
    const instances = await connectedChatInstances();
    const sender = instances.find(instance => instance.id === instanceId);
    const contacts = await chatList(`/v1/contacts?phone=${encodeURIComponent(phone)}&is_active=true`);
    const templates = await chatRequest(`/v1/templates?instance_id=${encodeURIComponent(instanceId)}&status=APPROVED`);
    const template = Array.isArray(templates.data) ? templates.data.find(item => item.name === templateName && item.language === "pt_BR") : null;
    let ensured = null;
    let ensureError = null;
    if (ensureContact) {
      try {
        const contact = await contactForChatInstance({ id: "diagnostic", name: "Diagnóstico de cobrança", phone, is_active: true, instance_id: null }, instanceId);
        ensured = { id: contact.id, instance_id: contact.instance_id, phone: contact.phone };
      } catch (error) {
        ensureError = { message: error instanceof Error ? error.message : String(error), status: error?.status, code: error?.code, details: error?.details };
      }
    }
    let conversation = null;
    let conversationError = null;
    if (ensureConversation && contacts[0]?.id) {
      try {
        const result = await chatRequest("/v1/conversations", { method: "POST", idempotencyKey: `diagnostic-${phone}-${instanceId}`, body: { contact_id: contacts[0].id, instance_id: instanceId } });
        conversation = result.data;
      } catch (error) {
        conversationError = { message: error instanceof Error ? error.message : String(error), status: error?.status, code: error?.code, details: error?.details };
      }
    }
    console.log(JSON.stringify({
      sender: sender ? { id: sender.id, name: sender.name, connected: sender.is_connected, provider: sender.api_provider } : null,
      exactContacts: contacts.filter(contact => contact.phone?.replace(/\D/g, "") === phone).map(contact => ({ id: contact.id, instance_id: contact.instance_id, active: contact.is_active })),
      template: template ? { name: template.name, status: template.status, language: template.language, components: template.components?.map(component => ({ type: component.type, format: component.format })) } : null,
      ensured,
      ensureError,
      conversation: conversation ? { id: conversation.id, contact_id: conversation.contact_id, instance_id: conversation.instance_id } : null,
      conversationError,
    }, null, 2));
  });
} finally {
  await vite.close();
}
