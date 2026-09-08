import { randomUUID } from 'node:crypto';
import { supabaseRequest } from './supabase-server';
import { DEFAULT_SCHEDULE, scheduleDue, type CollectionScheduleConfig } from './collection-schedule';
import { readCollectionSettings } from './collection-settings-server';
import { rulesForCustomer } from './collection-rules';
import { canonicalBillingPayment, collectionSchedule, collectionToday, FINANCIAL_INSTANCE, previewCollection, type BillingContact, type BillingPayment, type BillingTemplate } from './collection-policy';
import { chatList, chatRequest } from './chat-juridico-server';
import { asaasRequest, type AsaasPayment } from './asaas';
import { dispatchCollection } from './collection-dispatch';
export type ScheduleJob = { run_date: string; status: 'RUNNING' | 'COMPLETE' | 'REVIEW_REQUIRED'; payment_ids: string[] | null; cursor: number; sent: number; skipped: number; error: string | null; updated_at: string };
export async function readSchedule() {
  const [row] = await supabaseRequest<{ config: CollectionScheduleConfig }[]>('/rest/v1/collection_schedule?select=config&limit=1');
  return row?.config ?? { ...DEFAULT_SCHEDULE };
}
async function queueForToday(config: CollectionScheduleConfig, today: string) {
  const [state] = await supabaseRequest<{ active_generation: string | null }[]>('/rest/v1/asaas_base_sync?select=active_generation&limit=1');
  if (!state?.active_generation) throw new Error('Conclua a sincronização da base Asaas antes de programar envios.');
  const settings = await readCollectionSettings();
  const eligible = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const rows = await supabaseRequest<{ external_id: string; payload: AsaasPayment }[]>(`/rest/v1/asaas_base_payments?select=external_id,payload&generation=eq.${state.active_generation}&order=external_id&limit=1000&offset=${offset}`);
    for (const row of rows) if (['PENDING','OVERDUE'].includes(row.payload.status) && collectionSchedule(row.payload.dueDate ?? null, today, rulesForCustomer(settings, row.payload.customer), config).stage) eligible.add(row.external_id);
    if (rows.length < 1000) break;
  }
  if (!eligible.size) return [];
  const all = [...await chatList<BillingPayment>('/v1/payments?status=OVERDUE'), ...await chatList<BillingPayment>('/v1/payments?status=PENDING')];
  const byAsaas = new Map<string, Set<string>>();
  for (const raw of all) { const p = canonicalBillingPayment(raw); if (p.asaas_payment_id && eligible.has(p.asaas_payment_id)) { const ids = byAsaas.get(p.asaas_payment_id) ?? new Set<string>(); ids.add(p.id); byAsaas.set(p.asaas_payment_id, ids); } }
  return [...byAsaas.values()].filter(ids => ids.size === 1).map(ids => [...ids][0]);
}
/** One leased step per request; no detached work after the response. */
export async function advanceSchedule() {
  const config = await readSchedule();
  if (!scheduleDue(config)) return { active: false };
  const today = collectionToday(), now = new Date(), token = randomUUID();
  await supabaseRequest('/rest/v1/collection_schedule_jobs?on_conflict=tenant_id,run_date', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { run_date: today, lease_until: now.toISOString() } });
  const [job] = await supabaseRequest<ScheduleJob[]>(`/rest/v1/collection_schedule_jobs?run_date=eq.${today}&status=eq.RUNNING&lease_until=lte.${encodeURIComponent(now.toISOString())}`, { method: 'PATCH', prefer: 'return=representation', body: { lease_token: token, lease_until: new Date(now.getTime() + 300000).toISOString(), updated_at: now.toISOString() } });
  if (!job) return { active: false };
  const path = `/rest/v1/collection_schedule_jobs?run_date=eq.${today}&lease_token=eq.${token}`;
  try {
    if (!job.payment_ids) {
      const ids = await queueForToday(config, today);
      await supabaseRequest(path, { method: 'PATCH', body: { payment_ids: ids, status: ids.length ? 'RUNNING' : 'COMPLETE', lease_until: new Date().toISOString(), updated_at: new Date().toISOString() } });
      return { active: ids.length > 0 };
    }
    const paymentId = job.payment_ids[job.cursor];
    let skipped = true;
    if (paymentId) {
      const settings = await readCollectionSettings();
      const { data: raw } = await chatRequest<{ data: BillingPayment }>(`/v1/payments/${encodeURIComponent(paymentId)}`);
      const payment = canonicalBillingPayment(raw);
      if (payment.asaas_payment_id) {
        const source = await asaasRequest<AsaasPayment & { invoiceUrl?: string; deleted?: boolean }>(`/payments/${encodeURIComponent(payment.asaas_payment_id)}`);
        const payer = await asaasRequest<{ name?: string }>(`/customers/${encodeURIComponent(source.customer)}`);
        Object.assign(payment, { contact_name: payer.name ?? 'Cliente não identificado', status: source.deleted ? 'DELETED' : source.status, value: Number(source.value), due_date: source.dueDate ?? null, invoice_url: source.invoiceUrl ?? null });
        const contact = payment.contact_id ? (await chatRequest<{ data: BillingContact }>(`/v1/contacts/${encodeURIComponent(payment.contact_id)}`)).data : null;
        const { data: templates } = await chatRequest<{ data: BillingTemplate[] }>(`/v1/templates?instance_id=${FINANCIAL_INSTANCE}&status=APPROVED`);
        const row = previewCollection(payment, contact, templates, today, rulesForCustomer(settings, source.customer), config);
        // Re-check persisted authorization immediately before each outbound message.
        const latest = await readSchedule();
        if (!scheduleDue(latest) || collectionToday() !== today || JSON.stringify(latest) !== JSON.stringify(config)) {
          await supabaseRequest(path, { method: 'PATCH', body: { lease_until: new Date().toISOString() } });
          return { active: false };
        }
        if (!row.blocked) skipped = (await dispatchCollection(row, today)).skipped;
      }
    }
    const cursor = job.cursor + 1, complete = cursor >= job.payment_ids.length;
    await supabaseRequest(path, { method: 'PATCH', body: { cursor, sent: job.sent + (skipped ? 0 : 1), skipped: job.skipped + (skipped ? 1 : 0), status: complete ? 'COMPLETE' : 'RUNNING', lease_until: new Date().toISOString(), updated_at: new Date().toISOString() } });
    return { active: !complete };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha na programação.';
    await supabaseRequest(path, { method: 'PATCH', body: { status: 'REVIEW_REQUIRED', error: message, updated_at: new Date().toISOString() } });
    throw error;
  }
}

