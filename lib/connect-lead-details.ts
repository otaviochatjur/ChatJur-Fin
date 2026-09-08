import type { ConnectLead } from './metrics';
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function answerText(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Não informado';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.map(answerText).join('\n');
  if (typeof value === 'object') return Object.entries(record(value)).map(([key, item]) => `${key}: ${answerText(item)}`).join('\n');
  return String(value);
}
export function connectLeadAnswers(lead: ConnectLead) {
  const raw = record(lead.raw_payload), data = record(raw.data);
  const fields = Array.isArray(raw.fields) ? raw.fields : Array.isArray(data.fields) ? data.fields : [];
  if (fields.length) return fields.map((item, index) => {
    const field = record(item), options = Array.isArray(field.options) ? field.options.map(record) : [];
    const resolve = (value: unknown) => options.find(option => option.id === value)?.text ?? options.find(option => option.id === value)?.label ?? value;
    return { label: String(field.label ?? field.key ?? `Pergunta ${index + 1}`), value: answerText(Array.isArray(field.value) ? field.value.map(resolve) : resolve(field.value)) };
  });
  const metadata = new Set(['raw_payload', 'id', 'tenant_id', 'status', 'classified_as', 'linked_actor_id', 'created_at', 'updated_at', 'reviewed_at', 'reviewed_notes', 'tally_submission_id', 'tally_response_id', 'tally_form_id']);
  return Object.entries(lead).filter(([key, value]) => !metadata.has(key) && value !== null && value !== undefined).map(([key, value]) => ({ label: key.replaceAll('_', ' '), value: answerText(value) }));
}
