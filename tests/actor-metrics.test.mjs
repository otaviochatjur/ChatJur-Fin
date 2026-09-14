import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', configFile: false, root, cacheDir: 'node_modules/.vite-tests/actor-metrics', resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const { computeActorMetrics, computeActorPayout, computeActorPayoutDetail } = await vite.ssrLoadModule('/lib/metrics.ts');
const { payoutPeriodWindow } = await vite.ssrLoadModule('/lib/payout-period.ts');

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

test('a partner assigned directly to the customer overrides the payment-link attribution', () => {
  const otherActor = { id: 'other-partner', role: 'PARTNER', name: 'Outro parceiro', status: 'ACTIVE' };
  const subscription = { id: 'sub-direct', customer_id: 'cust-direct', payment_link_id: 'link-other', actor_id: otherActor.id, value: 600, billing_period: 'MONTHLY', status: 'ACTIVE' };
  const link = { id: 'link-other', actor_id: otherActor.id, status: 'ACTIVE' };
  const customer = { id: 'cust-direct', acquisition_actor_id: actor.id };

  const metrics = computeActorMetrics([actor, otherActor], [subscription], [link], [customer]);

  assert.equal(metrics[actor.id].clients, 1);
  assert.equal(metrics[actor.id].mrr, 600);
  assert.equal(metrics[otherActor.id].clients, 0);
  assert.equal(metrics[otherActor.id].mrr, 0);
});


test('linked clients include unconfirmed subscriptions without counting them as active or adding MRR', () => {
  const base = { payment_link_id: 'link', value: 500, billing_period: 'MONTHLY', actor_id: null };
  const result = computeActorMetrics([actor], [{...base,id:'a',customer_id:'c',status:null},{...base,id:'b',customer_id:'c',status:'ACTIVE'},{...base,id:'d',customer_id:'d',status:null}], [{id:'link',actor_id:actor.id,status:'ACTIVE'}])[actor.id];
  assert.equal(result.clients,2);assert.equal(result.activeClients,1);assert.equal(result.mrr,500);
});

test('repasse uses the partner assigned directly to the customer before link and subscription attribution', () => {
  const otherActor = { id: 'other-partner', role: 'PARTNER', name: 'Outro parceiro', status: 'ACTIVE' };
  const subscription = { id: 'sub-payout', customer_id: 'cust-payout', payment_link_id: 'link-payout', actor_id: otherActor.id, plan_id: 'plan', custom_plan_id: null, plan_name_raw: 'Plano mensal', value: 500, billing_period: 'MONTHLY', status: 'ACTIVE' };
  const payment = { subscription_id: subscription.id, status: 'RECEIVED', value: 500, payment_date: '2026-09-10', confirmed_date: null };
  const rates = [{ actor_id: actor.id, plan_id: null, custom_plan_id: null, rate_percent: 10 }];
  const attribution = { customers: [{ id: subscription.customer_id, acquisition_actor_id: actor.id }], links: [{ id: subscription.payment_link_id, actor_id: otherActor.id }] };

  const payout = computeActorPayout(actor.id, '2026-09', [subscription], [payment], rates, attribution);
  const otherPayout = computeActorPayout(otherActor.id, '2026-09', [subscription], [payment], rates, attribution);
  const detail = computeActorPayoutDetail(actor.id, '2026-09', [subscription], [payment], rates, attribution);

  assert.equal(payout.grossReceived, 500);
  assert.equal(payout.commission, 50);
  assert.equal(detail.length, 1);
  assert.equal(otherPayout.grossReceived, 0);
  assert.equal(otherPayout.commission, 0);
});

test('repasse month uses payments through day 30 of the previous month', () => {
  assert.deepEqual(payoutPeriodWindow('2026-09'), { competencePeriod: '2026-08', start: '2026-08-01', cutoff: '2026-08-30', endExclusive: '2026-08-31' });
  assert.deepEqual(payoutPeriodWindow('2027-03'), { competencePeriod: '2027-02', start: '2027-02-01', cutoff: '2027-02-28', endExclusive: '2027-03-01' });
  assert.deepEqual(payoutPeriodWindow('2026-01'), { competencePeriod: '2025-12', start: '2025-12-01', cutoff: '2025-12-30', endExclusive: '2025-12-31' });
});
