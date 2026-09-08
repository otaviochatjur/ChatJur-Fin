import { randomUUID } from 'node:crypto';
import { supabaseRequest } from './supabase-server';
import { getIntegration, openSecret } from './integrations-server';
import { syncTallySubmissions } from './tally-sync';
export async function pollTally() {
  const integration = await getIntegration('tally');
  if (!integration?.account_id) return { configured: false, imported: 0 };
  const formId = integration.account_id;
  await supabaseRequest('/rest/v1/tally_sync_state?on_conflict=tenant_id', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { form_id: formId } });
  const [state] = await supabaseRequest<{ form_id: string; checked_at: string | null; error: string | null }[]>('/rest/v1/tally_sync_state?select=form_id,checked_at,error&limit=1');
  if (state?.form_id === formId && state.checked_at && Date.now() - Date.parse(state.checked_at) < 60000) return { configured: true, imported: 0, checkedAt: state.checked_at, error: state.error };
  const token = randomUUID(), now = new Date();
  const rows = await supabaseRequest<unknown[]>(`/rest/v1/tally_sync_state?lease_until=lte.${encodeURIComponent(now.toISOString())}`, { method: 'PATCH', prefer: 'return=representation', body: { lease_token: token, lease_until: new Date(now.getTime() + 300000).toISOString(), form_id: formId } });
  if (!rows.length) return { configured: true, imported: 0 };
  const path = `/rest/v1/tally_sync_state?lease_token=eq.${token}`;
  try {
    const result = await syncTallySubmissions(openSecret(integration.encrypted_key, integration.tenant_id, 'tally'), formId);
    const checkedAt = new Date().toISOString();
    await supabaseRequest(path, { method: 'PATCH', body: { checked_at: checkedAt, error: null, lease_until: checkedAt } });
    return { configured: true, ...result, checkedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao sincronizar Tally.';
    await supabaseRequest(path, { method: 'PATCH', body: { checked_at: new Date().toISOString(), lease_until: new Date().toISOString(), error: message } });
    throw error;
  }
}
