import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", cacheDir: "node_modules/.vite-tests/collection-policy", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const { previewCollection, dayDistance, collectionToday, FINANCIAL_INSTANCE, COLLECTION_STAGES } = await vite.ssrLoadModule("/lib/collection-policy.ts");
const payment = { id: "payment", contact_id: "contact", contact_name: "Ana", due_date: "2026-09-08", value: 100, status: "OVERDUE", invoice_url: "https://asaas.com/i/example" };
const contact = { id: "contact", name: "Ana", is_active: true, phone: "5511999999999", instance_id: FINANCIAL_INSTANCE };
const template = { name: "cobranca_d_mais_01", status: "APPROVED", instance_id: FINANCIAL_INSTANCE, language: "pt_BR", components: [{ type: "BODY", text: "Olá {{1}}, vencimento {{2}}: {{3}}" }] };
test("uses exact cadence days and Sao Paulo calendar boundaries", () => {
  assert.deepEqual(Object.keys(COLLECTION_STAGES).map(Number).sort((a,b)=>a-b), [-5,0,1,2,5,10,20,25,30]);
  assert.equal(collectionToday(new Date("2026-09-09T01:00:00Z")), "2026-09-08");
  assert.equal(dayDistance("2026-09-09", "2026-09-14"), -5);
  assert.ok(Number.isNaN(dayDistance("2026-09-09", "2026-02-30")));
  assert.ok(Number.isNaN(dayDistance("2026-09-09", "2026-99-99")));
});
test("renders exactly the approved template variables", () => {
  const result = previewCollection(payment, contact, [template], "2026-09-09");
  assert.equal(result.blocked, null);
  assert.equal(result.text, "Olá Ana, vencimento 08/09/2026: https://asaas.com/i/example");
  assert.deepEqual(result.parameters, { body_1: "Ana", body_2: "08/09/2026", body_3: payment.invoice_url });
  const simple = previewCollection(payment, contact, [{ ...template, components: [{ type: "BODY", text: "Olá {{1}}" }] }], "2026-09-09");
  assert.deepEqual(simple.parameters, { body_1: "Ana" });
});
test("blocks inactive, paid, wrong-channel, missing-template and incomplete previews", () => {
  for (const [p,c,t] of [
    [payment, null, [template]], [payment, { ...contact, is_active: false }, [template]],
    [{ ...payment, status: "RECEIVED" }, contact, [template]],
    [payment, { ...contact, instance_id: "other" }, [template]], [payment, contact, []],
    [{ ...payment, invoice_url: null }, contact, [template]],
    [payment, contact, [{ ...template, components: [{ type: "BODY", text: "{{4}}" }] }]],
    [payment, contact, [{ ...template, components: [{ type: "HEADER", format: "IMAGE" }] }]],
  ]) assert.ok(previewCollection(p,c,t,"2026-09-09").blocked);
  assert.equal(previewCollection(payment, contact, [template], "2026-09-11").blocked, "Sem envio hoje");
});
test("keeps all linked subscriptions and removes disabled ones from current plans", async () => {
  const { presentSubscription, currentLinkedSubscriptions } = await vite.ssrLoadModule("/lib/subscription-presentation.ts");
  const base = { payment_link_id: "link", plan_name_raw: "Asaas name", payment_links: { plans: { name: "Plano CRM + IA [MENSAL]" } }, status: "ACTIVE" };
  const a = presentSubscription({ ...base, id: "a" });
  const b = presentSubscription({ ...base, id: "b", status: null });
  const c = presentSubscription({ ...base, id: "c", status: "CANCELLED" });
  const d = presentSubscription({ ...base, id: "d", payment_links: null });
  assert.deepEqual(currentLinkedSubscriptions([a,b,c,d]).map(s=>s.id), ["a", "b"]);
  assert.equal(presentSubscription({ ...base, payment_link_id: null, plans: { name: "Stale catalog" } }).display_plan_name, "—");
});
