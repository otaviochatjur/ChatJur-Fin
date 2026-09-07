import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const env = parseEnv(readFileSync('.env', 'utf8'));
const origin = 'http://127.0.0.1:5176';
const users = [];
async function admin(path, method = 'GET', body) {
  const r = await fetch(env.SUPABASE_URL + path, { method, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(r.ok, `Admin ${method} failed: ${r.status}`);
  const text = await r.text(); return text ? JSON.parse(text) : null;
}
async function app(path, cookie = '', method = 'GET', body) {
  const r = await fetch(origin + path, { method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json(), cookie: r.headers.getSetCookie().map(s => s.split(';')[0]).join('; ') };
}
try {
  assert.equal((await app('/api/auth')).status, 401);
  for (let i = 0; i < 2; i++) {
    const email = `nexo-test-${randomUUID()}@example.invalid`;
    const password = randomUUID() + randomUUID();
    const user = await admin('/auth/v1/admin/users', 'POST', { email, password, email_confirm: true });
    users.push(user.id);
    const login = await app('/api/auth', '', 'POST', { email, password });
    assert.equal(login.status, 200); assert.ok(login.cookie);
    const session = await app('/api/auth', login.cookie);
    assert.equal(session.status, 200); assert.equal(session.data.user.id, user.id);
    const before = await app('/api/plans', login.cookie);
    assert.equal(before.status, 200); assert.equal(before.data.plans.length, 0);
    const plan = await app('/api/plans', login.cookie, 'POST', { code: 'NEXO_TEST', name: `Teste ${i}`, billingPeriod: 'MONTHLY', standardValue: 10 });
    assert.equal(plan.status, 201);
    const after = await app('/api/plans', login.cookie);
    assert.equal(after.data.plans.length, 1); assert.equal(after.data.plans[0].name, `Teste ${i}`);
    const integration = await app('/api/integrations', login.cookie);
    assert.equal(integration.status, 200); assert.equal(integration.data.asaas.configured, false); assert.equal(integration.data.chat.configured, false);
    const secret = `test-only-${randomUUID()}`;
    assert.equal((await app('/api/integrations', login.cookie, 'POST', { provider: 'chat-juridico', environment: 'production', apiKey: secret })).status, 400);
    const saved = await app('/api/integrations', login.cookie);
    assert.equal(saved.data.chat.configured, false); assert.ok(!JSON.stringify(saved).includes(secret));
    assert.equal((await app('/api/auth', login.cookie, 'DELETE')).status, 200);
  }
  console.log('PASS: login, session, isolated plans with identical codes, isolated integrations, no secret exposure, logout.');
} finally {
  for (const id of users) {
    const tenants = await admin(`/rest/v1/nexo_tenants?owner_user_id=eq.${id}&select=id`);
    for (const tenant of tenants) {
      for (const table of ['nexo_integrations', 'audit_events', 'plans']) await admin(`/rest/v1/${table}?tenant_id=eq.${tenant.id}`, 'DELETE');
      await admin(`/rest/v1/nexo_tenants?id=eq.${tenant.id}`, 'DELETE');
    }
    await admin(`/auth/v1/admin/users/${id}`, 'DELETE');
  }
  console.log(`Cleanup: ${users.length} temporary accounts removed.`);
}
