import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', root, configFile: false, cacheDir: 'node_modules/.vite-tests/scheduling', resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const { scheduleSchema, scheduleDue, DEFAULT_SCHEDULE } = await vite.ssrLoadModule('/lib/collection-schedule.ts');
const { collectionSchedule, FINANCIAL_INSTANCE } = await vite.ssrLoadModule('/lib/collection-policy.ts');
const { connectLeadAnswers } = await vite.ssrLoadModule('/lib/connect-lead-details.ts');
const { withWebhookTenant } = await vite.ssrLoadModule('/lib/tenant-server.ts');
const { dispatchCollection } = await vite.ssrLoadModule('/lib/collection-dispatch.ts');
test('schedule is disabled by default and enforces Brasilia time', () => {
  assert.equal(scheduleDue(DEFAULT_SCHEDULE, new Date('2026-09-08T15:00:00Z')), false);
  const config = { ...DEFAULT_SCHEDULE, enabled: true };
  assert.equal(scheduleDue(config, new Date('2026-09-08T11:59:00Z')), false);
  assert.equal(scheduleDue(config, new Date('2026-09-08T12:00:00Z')), true);
  assert.equal(scheduleSchema.safeParse({ ...config, time: '25:00' }).success, false);
});
test('Saturday, Sunday and holiday permissions are independent and transfer stages consistently', () => {
  const config = { ...DEFAULT_SCHEDULE, enabled: true };
  assert.equal(scheduleDue(config, new Date('2026-09-05T15:00:00Z')), false);
  assert.equal(scheduleDue({ ...config, saturday: true }, new Date('2026-09-05T15:00:00Z')), true);
  assert.equal(scheduleDue({ ...config, saturday: true }, new Date('2026-09-06T15:00:00Z')), false);
  assert.equal(scheduleDue({ ...config, sunday: true }, new Date('2026-09-06T15:00:00Z')), true);
  assert.equal(scheduleDue(config, new Date('2026-09-07T15:00:00Z')), false);
  assert.equal(scheduleDue({ ...config, holidays: true }, new Date('2026-09-07T15:00:00Z')), true);
  assert.equal(scheduleDue({ ...config, holidays: true }, new Date('2026-11-15T15:00:00Z')), false);
  const rules = [{ days: 0, template: 'due', label: 'Vence' }];
  assert.equal(collectionSchedule('2026-09-05', '2026-09-08', rules).stage, 'due');
  assert.equal(collectionSchedule('2026-09-05', '2026-09-05', rules, { ...config, saturday: true }).stage, 'due');
  assert.equal(collectionSchedule('2026-09-05', '2026-09-08', rules, { ...config, saturday: true }).stage, null);
});
test('full application details retain unmapped answers, false, zero, lists, options and attachments', () => {
  const result = connectLeadAnswers({ raw_payload: { fields: [
    { label: 'Pergunta nova', value: 'Resposta completa' }, { label: 'Consentimento', value: false }, { label: 'Quantidade', value: 0 },
    { label: 'Escolhas', value: ['id'], options: [{ id: 'id', text: 'Advocacia' }] },
    { label: 'Anexo', value: [{ name: 'curriculo.pdf', url: 'https://example.com/file' }] },
  ] } });
  assert.equal(result.length, 5); assert.equal(result[1].value, 'Não'); assert.equal(result[2].value, '0'); assert.equal(result[3].value, 'Advocacia'); assert.match(result[4].value, /curriculo.pdf/);
  assert.equal(connectLeadAnswers({ raw_payload: { data: { fields: [{ label: 'Antigo', value: 'Preservado' }] } } })[0].value, 'Preservado');
});
test('manual and scheduled attempts share a unique claim; recorded attempts never send again', async () => {
  const original = globalThis.fetch, env = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test' });
  let reads = 0;
  globalThis.fetch = async input => { const url = new URL(input); assert.equal(url.host, 'db.invalid'); assert.equal(url.pathname, '/rest/v1/audit_events'); reads++; return Response.json([{ id: 'previous-attempt' }]); };
  try {
    const result = await withWebhookTenant({ id: 'tenant', legacy: true }, () => dispatchCollection({ blocked: null, stage: 'due', payment: { id: 'payment' }, contact: { instance_id: FINANCIAL_INSTANCE } }, '2026-09-08'));
    assert.equal(result.skipped, true); assert.equal(reads, 1);
  } finally { globalThis.fetch = original; for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; } }
});
test('disabled scheduling makes no provider calls and creates no jobs', async () => {
  const { advanceSchedule } = await vite.ssrLoadModule('/lib/collection-schedule-server.ts');
  const original = globalThis.fetch, env = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test' });
  globalThis.fetch = async input => { assert.equal(new URL(input).pathname, '/rest/v1/collection_schedule'); return Response.json([]); };
  try { assert.deepEqual(await withWebhookTenant({ id: 'tenant', legacy: true }, () => advanceSchedule()), { active: false }); }
  finally { globalThis.fetch = original; for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; } }
});

test('scheduled worker rechecks Asaas and skips a payment settled after the queue was built', async () => {
  const { advanceSchedule } = await vite.ssrLoadModule('/lib/collection-schedule-server.ts');
  const { sealSecret } = await vite.ssrLoadModule('/lib/integrations-server.ts');
  const { collectionToday } = await vite.ssrLoadModule('/lib/collection-policy.ts');
  const original = globalThis.fetch, previous = { ...process.env };
  const keys = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','INTEGRATIONS_ENCRYPTION_KEY','ASAAS_API_KEY','ASAAS_BASE_URL'];
  Object.assign(process.env, { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test', INTEGRATIONS_ENCRYPTION_KEY: 'a'.repeat(64), ASAAS_API_KEY: 'test', ASAAS_BASE_URL: 'https://api.asaas.com/v3' });
  const encrypted = sealSecret('mock-key', 'tenant', 'chat-juridico');
  const today = collectionToday();
  let finalJob;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input), table = url.pathname.split('/').at(-1), body = options.body ? JSON.parse(options.body) : null;
    if (url.host === 'api.asaas.com') return Response.json(url.pathname.includes('/payments/') ? { id: 'pay', customer: 'cus', status: 'RECEIVED', value: 100, dueDate: today, invoiceUrl: 'https://example.com/i' } : { name: 'Ana' });
    if (url.host === 'api.jur.chat') {
      assert.ok(!options.method || options.method === 'GET', 'No external message or conversation may be created for a paid charge');
      if (url.pathname.includes('/payments/')) return Response.json({ data: { id: 'chatpay', asaas_payment_id: 'pay', contact_id: 'contact', status: 'OVERDUE' } });
      if (url.pathname.includes('/contacts/')) return Response.json({ data: { id: 'contact', is_active: true, phone: '5511999999999', instance_id: FINANCIAL_INSTANCE } });
      return Response.json({ data: [] });
    }
    if (table === 'nexo_integrations') return Response.json(url.searchParams.get('provider') === 'eq.chat-juridico' ? [{ encrypted_key: encrypted, tenant_id: 'tenant' }] : []);
    if (table === 'collection_schedule') return Response.json([{ config: { enabled: true, time: '00:00', saturday: true, sunday: true, holidays: true } }]);
    if (table === 'collection_settings') return Response.json([]);
    assert.equal(table, 'collection_schedule_jobs');
    if (options.method === 'PATCH' && url.searchParams.has('lease_until')) return Response.json([{ payment_ids: ['chatpay'], cursor: 0, sent: 0, skipped: 0 }]);
    if (options.method === 'PATCH') finalJob = body;
    return Response.json([]);
  };
  try {
    assert.deepEqual(await withWebhookTenant({ id: 'tenant', legacy: true }, () => advanceSchedule()), { active: false });
    assert.equal(finalJob.status, 'COMPLETE'); assert.equal(finalJob.sent, 0); assert.equal(finalJob.skipped, 1);
  } finally { globalThis.fetch = original; for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
});
