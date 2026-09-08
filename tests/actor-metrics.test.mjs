import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', configFile: false, root, cacheDir: 'node_modules/.vite-tests/actor-metrics', resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const { computeActorMetrics } = await vite.ssrLoadModule('/lib/metrics.ts');

const actor = { id: 'calculo-juridico', role: 'INSTITUTIONAL', name: 'Cálculo Jurídico', status: 'ACTIVE' };

test('a client counts for the actor currently attributed to their payment link, even if the subscription row predates that attribution', () => {
  // Subscription was created back when the link had no partner attached yet
  // (actor_id snapshot taken at creation time — see lib/payment-sync.ts
  // resolveSubscription, which never patches actor_id on an existing row).
  const subscription = { id: 'sub-1', customer_id: 'cust-1', payment_link_id: 'link-1', actor_id: null, value: 500, billing_period: 'MONTHLY', status: 'ACTIVE' };
  // A legacy-import script later backfilled the link's attribution to the
  // real partner (this is the live, authoritative attribution — same source
  // clients-section.tsx's display_actor_id already trusts).
  const link = { id: 'link-1', actor_id: actor.id, status: 'ACTIVE' };

  const metrics = computeActorMetrics([actor], [subscription], [link]);

  assert.equal(metrics[actor.id].clients, 1, 'client attributed via the link should be counted even though subscription.actor_id is stale');
  assert.equal(metrics[actor.id].mrr, 500);
});

test('falls back to the subscription\'s own actor_id when it carries no payment link (legacy/manual rows)', () => {
  const subscription = { id: 'sub-2', customer_id: 'cust-2', payment_link_id: null, actor_id: actor.id, value: 300, billing_period: 'MONTHLY', status: 'ACTIVE' };
  const metrics = computeActorMetrics([actor], [subscription], []);
  assert.equal(metrics[actor.id].clients, 1);
});


test('linked clients include unconfirmed subscriptions without counting them as active or adding MRR', () => {
  const base = { payment_link_id: 'link', value: 500, billing_period: 'MONTHLY', actor_id: null };
  const result = computeActorMetrics([actor], [{...base,id:'a',customer_id:'c',status:null},{...base,id:'b',customer_id:'c',status:'ACTIVE'},{...base,id:'d',customer_id:'d',status:null}], [{id:'link',actor_id:actor.id,status:'ACTIVE'}])[actor.id];
  assert.equal(result.clients,2);assert.equal(result.activeClients,1);assert.equal(result.mrr,500);
});
