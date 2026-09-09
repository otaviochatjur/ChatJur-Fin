import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", root, configFile: false, cacheDir: "node_modules/.vite-tests/collection-kanban", resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());

function row(paymentId, customerId, dueDate, status = "OVERDUE", internalCustomerId = null) {
  return { id: paymentId, report_id: "kanban:overdue", asaas_payment_id: paymentId, internal_customer_id: internalCustomerId, snapshot: { payment_id: paymentId, customer_id: customerId, name: customerId, status, value: 100, due_date: dueDate } };
}

test("the collection kanban includes overdue payments from every month and groups each customer by the greatest delay", async () => {
  const { buildCollectionKanban } = await vite.ssrLoadModule("/lib/collection-kanban.ts");
  const cards = buildCollectionKanban([
    row("old", "customer-a", "2026-01-01", "OVERDUE", "internal-a"),
    row("recent", "customer-a", "2026-09-08", "OVERDUE", "internal-a"),
    row("other-month", "customer-b", "2026-08-30", "OVERDUE", "internal-b"),
    row("alias", "customer-a-alias", "2026-09-07", "OVERDUE", "internal-a"),
    row("paid", "customer-c", "2026-01-01", "RECEIVED", "internal-c"),
  ], "2026-09-09");
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(card => card.id).sort(), ["internal-a", "internal-b"]);
  assert.equal(cards.find(card => card.id === "internal-a").payments.length, 3);
  assert.equal(cards.find(card => card.id === "internal-a").lane, 7);
  assert.equal(cards.find(card => card.id === "internal-a").internalCustomerId, "internal-a");
});
