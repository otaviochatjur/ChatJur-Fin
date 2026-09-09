import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", cacheDir: "node_modules/.vite-tests/collection-sender", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());

test("the Financeiro number is the default sender even when another number has more templates", async () => {
  const { preferredCollectionInstance } = await vite.ssrLoadModule("/lib/collection-sender.ts");
  const { FINANCIAL_INSTANCE } = await vite.ssrLoadModule("/lib/collection-policy.ts");
  const instances = [
    { id: "sales", name: "Comercial", approved_template_count: 20 },
    { id: FINANCIAL_INSTANCE, name: "Financeiro", approved_template_count: 5 },
  ];
  assert.equal(preferredCollectionInstance(instances), FINANCIAL_INSTANCE);
});

test("the sender selection falls back safely when the configured Financeiro id is unavailable", async () => {
  const { preferredCollectionInstance } = await vite.ssrLoadModule("/lib/collection-sender.ts");
  assert.equal(preferredCollectionInstance([
    { id: "sales", name: "Comercial", approved_template_count: 20 },
    { id: "finance", name: "WhatsApp Financeiro", approved_template_count: 3 },
  ]), "finance");
  assert.equal(preferredCollectionInstance([{ id: "only", name: "Principal", approved_template_count: 1 }]), "only");
  assert.equal(preferredCollectionInstance([]), "");
});
