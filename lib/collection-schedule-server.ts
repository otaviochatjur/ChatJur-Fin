import { randomUUID } from 'node:crypto';
import { supabaseRequest } from './supabase-server';
import { DEFAULT_SCHEDULE, scheduleDue, scheduleSchema, type CollectionScheduleConfig } from './collection-schedule';
import { readCollectionSettings } from './collection-settings-server';
import { rulesForCustomer } from './collection-rules';
import { collectionSchedule, collectionToday, type BillingTemplate } from './collection-policy';
import { chatRequest, requireConnectedChatInstance } from './chat-juridico-server';
import { type AsaasPayment } from './asaas';
import { dispatchCollection } from './collection-dispatch';
import { freshCollectionPreview } from './collection-preview-server';
export type ScheduleJob = { run_date: string; status: 'RUNNING' | 'COMPLETE' | 'REVIEW_REQUIRED'; instance_id: string | null; payment_ids: string[] | null; cursor: number; sent: number; skipped: number; error: string | null; updated_at: string };
export async function readSchedule() {
  const [row] = await supabaseRequest<{ config: CollectionScheduleConfig }[]>('/rest/v1/collection_schedule?select=config&limit=1');
  const parsed = scheduleSchema.safeParse({ ...DEFAULT_SCHEDULE, ...(row?.config ?? {}) });
  return parsed.success ? parsed.data : { ...DEFAULT_SCHEDULE };
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
  return [...eligible];
}
/** One leased step per request; no detached work after the response. */
export async function advanceSchedule() {
  const config = await readSchedule();
  if (!scheduleDue(config)) return { active: false };
  if (!config.instanceId) return { active: false };
  await requireConnectedChatInstance(config.instanceId);
  const today = collectionToday(), now = new Date(), token = randomUUID();
  await supabaseRequest('/rest/v1/collection_schedule_jobs?on_conflict=tenant_id,run_date', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { run_date: today, instance_id: config.instanceId, lease_until: now.toISOString() } });
  const [job] = await supabaseRequest<ScheduleJob[]>(`/rest/v1/collection_schedule_jobs?run_date=eq.${today}&status=eq.RUNNING&lease_until=lte.${encodeURIComponent(now.toISOString())}`, { method: 'PATCH', prefer: 'return=representation', body: { lease_token: token, lease_until: new Date(now.getTime() + 300000).toISOString(), updated_at: now.toISOString() } });
  if (!job) return { active: false };
  const path = `/rest/v1/collection_schedule_jobs?run_date=eq.${today}&lease_token=eq.${token}`;
  try {
    if (job.instance_id && job.instance_id !== config.instanceId) {
      await supabaseRequest(path, { method: 'PATCH', body: { status: 'REVIEW_REQUIRED', error: 'O número remetente foi alterado durante esta execução. Revise o histórico e inicie um novo lote no próximo dia.', updated_at: new Date().toISOString() } });
      return { active: false };
    }
    if (!job.payment_ids) {
      const ids = await queueForToday(config, today);
      await supabaseRequest(path, { method: 'PATCH', body: { payment_ids: ids, status: ids.length ? 'RUNNING' : 'COMPLETE', lease_until: new Date().toISOString(), updated_at: new Date().toISOString() } });
      return { active: ids.length > 0 };
    }
    const paymentId = job.payment_ids[job.cursor];
    let skipped = true;
    if (paymentId) {
      const settings = await readCollectionSettings();
      const { data: templates } = await chatRequest<{ data: BillingTemplate[] }>(`/v1/templates?instance_id=${encodeURIComponent(config.instanceId)}&status=APPROVED`);
      const row = await freshCollectionPreview(paymentId, config.instanceId, templates, settings, today, config);
      // Re-check persisted authorization immediately before each outbound message.
      const latest = await readSchedule();
      if (!scheduleDue(latest) || collectionToday() !== today || JSON.stringify(latest) !== JSON.stringify(config)) {
        await supabaseRequest(path, { method: 'PATCH', body: { lease_until: new Date().toISOString() } });
        return { active: false };
      }
      if (!row.blocked) skipped = (await dispatchCollection(row, today)).skipped;
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

