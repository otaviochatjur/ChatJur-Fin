import { createHash } from 'node:crypto';
import { currentTenant } from './tenant-server';
import { supabaseRequest } from './supabase-server';
import { chatRequest, openChatConversation, requireConnectedChatInstance, sameChatPhone } from './chat-juridico-server';
import { type BillingContact, type CollectionPreview } from './collection-policy';
/** Shared atomic claim: manual and scheduled execution cannot repeat the same payment/day/stage. */
export async function dispatchCollection(row: CollectionPreview, today: string) {
  if (row.blocked || !row.stage) throw new Error('Cobrança não apta para envio.');
  const tenant = await currentTenant(), payment = row.payment;
  if (!row.contact) throw new Error('Contato não identificado.');
  let attemptId: string | null = null;
  let phase = 'claim';
  let messageRequested = false;
  try {
    const hash = createHash("sha256").update(`${tenant.id}:${payment.id}:${today}:${row.stage}`).digest("hex").slice(0, 32);
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
    const existing = await supabaseRequest<{ id: string; action: string }[]>(`/rest/v1/audit_events?id=eq.${id}&select=id,action`);
    if (existing.length && existing[0].action !== 'FAILED') return { skipped: true };
    await requireConnectedChatInstance(row.instance_id);
    // The unique ID claims this payment/day atomically, including concurrent approvals.
    if (existing.length) await supabaseRequest(`/rest/v1/audit_events?id=eq.${id}&action=eq.FAILED`, { method: 'PATCH', body: { action: 'SENDING', after_json: { ...row, date: today } } });
    else await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { id, entity_type: "collection_send", entity_id: payment.id, action: "SENDING", after_json: { ...row, date: today } } });
    attemptId = id;
    phase = 'recipient';
    if (!row.contact.phone) throw new Error("Telefone não informado.");
    phase = 'conversation';
    const conversation = await openChatConversation(row.contact, row.instance_id, `conversation-${id}`);
    if (conversation.instance_id !== row.instance_id || !conversation.contact_id) throw new Error("A conversa retornada não corresponde ao número escolhido.");
    const { data: resolved } = await chatRequest<{ data: BillingContact }>(`/v1/contacts/${encodeURIComponent(conversation.contact_id)}`);
    if (resolved.is_active !== true || !sameChatPhone(resolved.phone, row.contact.phone)) throw new Error("A conversa retornada não corresponde ao destinatário aprovado.");
    phase = 'message';
    messageRequested = true;
    await chatRequest(`/v1/conversations/${encodeURIComponent(conversation.id)}/messages`, { method: "POST", idempotencyKey: `collection-${id}`, body: { type: "template", instance_id: row.instance_id, template: { name: row.stage, language: row.language, parameters: row.parameters } } });
    phase = 'audit';
    await supabaseRequest(`/rest/v1/audit_events?id=eq.${id}`, { method: "PATCH", body: { action: "SENT" } });
    return { skipped: false };
  } catch (error) {
    if (attemptId) {
      const detail = error instanceof Error ? error.message : 'Falha desconhecida.';
      await supabaseRequest(`/rest/v1/audit_events?id=eq.${attemptId}`, { method: 'PATCH', body: { action: messageRequested ? 'REVIEW_REQUIRED' : 'FAILED', after_json: { ...row, date: today, error: detail, failure_phase: phase } } }).catch(() => null);
      if (!messageRequested) throw new Error(`Mensagem não enviada: ${detail}`);
      throw new Error('Resultado do envio incerto. Confira o histórico e a conversa antes de continuar.');
    }
    throw error;
  }
}
