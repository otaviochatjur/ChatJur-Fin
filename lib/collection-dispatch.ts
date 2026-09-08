import { createHash } from 'node:crypto';
import { currentTenant } from './tenant-server';
import { supabaseRequest } from './supabase-server';
import { chatRequest } from './chat-juridico-server';
import { FINANCIAL_INSTANCE, type CollectionPreview } from './collection-policy';
/** Shared atomic claim: manual and scheduled execution cannot repeat the same payment/day/stage. */
export async function dispatchCollection(row: CollectionPreview, today: string) {
  if (row.blocked || !row.stage) throw new Error('Cobrança não apta para envio.');
  const tenant = await currentTenant(), payment = row.payment;
  let attemptId: string | null = null;
  try {
    const hash = createHash("sha256").update(`${tenant.id}:${payment.id}:${today}:${row.stage}`).digest("hex").slice(0, 32);
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
    const existing = await supabaseRequest<{ id: string }[]>(`/rest/v1/audit_events?id=eq.${id}&select=id`);
    if (existing.length) return { skipped: true };
    // The unique ID claims this payment/day atomically, including concurrent approvals.
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { id, entity_type: "collection_send", entity_id: payment.id, action: "SENDING", after_json: { ...row, date: today } } });
    attemptId = id;
    const { data: conversation } = await chatRequest<{ data: { id: string; instance_id: string; contact_id: string } }>("/v1/conversations", { method: "POST", idempotencyKey: `conversation-${id}`, body: { contact_id: payment.contact_id, instance_id: FINANCIAL_INSTANCE } });
    if (conversation.instance_id !== FINANCIAL_INSTANCE || conversation.contact_id !== payment.contact_id) throw new Error("A conversa retornada não corresponde ao contato e número financeiro aprovados.");
    await chatRequest(`/v1/conversations/${encodeURIComponent(conversation.id)}/messages`, { method: "POST", idempotencyKey: `collection-${id}`, body: { type: "template", instance_id: FINANCIAL_INSTANCE, template: { name: row.stage, language: row.language, parameters: row.parameters } } });
    await supabaseRequest(`/rest/v1/audit_events?id=eq.${id}`, { method: "PATCH", body: { action: "SENT" } });
    return { skipped: false };
  } catch (error) {
    if (attemptId) {
      await supabaseRequest(`/rest/v1/audit_events?id=eq.${attemptId}`, { method: 'PATCH', body: { action: 'REVIEW_REQUIRED' } }).catch(() => null);
      throw new Error('Resultado do envio incerto. Confira o histórico e a conversa antes de continuar.');
    }
    throw error;
  }
}
