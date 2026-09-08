import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
Object.assign(process.env, parseEnv(readFileSync('.env', 'utf8')));
const root = process.cwd();
const vite = await createServer({ appType: 'custom', root, configFile: false, cacheDir: 'node_modules/.vite-tests/verify-scheduling', resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { adminRequest, withWebhookTenant } = await vite.ssrLoadModule('/lib/tenant-server.ts');
  const [tenant] = await adminRequest('/rest/v1/nexo_tenants?reserved_email=eq.otavio%40chatjuridico.com.br&select=*');
  assert.ok(tenant?.owner_user_id);
  await withWebhookTenant(tenant, async () => {
    const { pollTally } = await vite.ssrLoadModule('/lib/tally-poll.ts');
    const { readSchedule } = await vite.ssrLoadModule('/lib/collection-schedule-server.ts');
    const { supabaseRequest } = await vite.ssrLoadModule('/lib/supabase-server.ts');
    const { connectLeadAnswers } = await vite.ssrLoadModule('/lib/connect-lead-details.ts');
    const tally = await pollTally();
    assert.equal(tally.configured, true); assert.ok(!tally.error);
    const again = await pollTally(); assert.equal(again.imported, 0);
    const config = await readSchedule(); assert.equal(config.enabled, false);
    const leads = await supabaseRequest('/rest/v1/connect_leads?select=*&order=created_at.desc');
    assert.ok(leads.every(lead => connectLeadAnswers(lead).length > 0));
    console.log(JSON.stringify({ tally, secondPollThrottled: !!again.checkedAt, scheduleDisabled: !config.enabled, pending: leads.filter(lead => lead.status === 'PENDING').length, answerCounts: leads.map(lead => connectLeadAnswers(lead).length) }));
  });
} finally { await vite.close(); }
