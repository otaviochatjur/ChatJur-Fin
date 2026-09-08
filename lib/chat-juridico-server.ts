import { readIntegrationKey } from "./integrations-server";

export type ChatInstance = { id: string; name: string | null; phone_id: string | null; display_phone_number: string | null; is_connected: boolean; api_provider?: string | null; approved_template_count?: number; approved_template_names?: string[] };
export class ChatRequestError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: Record<string, unknown>) { super(message); }
}

export async function chatRequest<T>(path: string, options: { method?: string; body?: unknown; idempotencyKey?: string; apiKey?: string } = {}): Promise<T> {
  const apiKey = options.apiKey ?? (await readIntegrationKey("chat-juridico"))?.apiKey;
  if (!apiKey) throw new Error("Cadastre sua chave do Chat Jurídico em Integrações.");
  if (!path.startsWith("/v1/")) throw new Error("Rota inválida.");
  const response = await fetch(`https://api.jur.chat${path}`, {
    method: options.method ?? "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json", ...(options.idempotencyKey ? { "X-Idempotency-Key": options.idempotencyKey } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (response.status >= 300 && response.status < 400) throw new Error("O Chat Jurídico retornou um redirecionamento inesperado. A chave não foi encaminhada para outro endereço.");
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string; [key: string]: unknown } } | null;
    throw new ChatRequestError(payload?.error?.message ?? `Chat Jurídico retornou ${response.status}. Confira a chave e as permissões.`, response.status, payload?.error?.code, payload?.error);
  }
  return response.json() as Promise<T>;
}

export async function connectedChatInstances() {
  const result = await chatRequest<{ data: ChatInstance[] }>("/v1/instances");
  if (!Array.isArray(result.data)) throw new Error("O Chat Jurídico retornou uma lista de números inválida.");
  return result.data.filter(instance => instance.is_connected === true);
}

export async function requireConnectedChatInstance(instanceId: string) {
  const instance = (await connectedChatInstances()).find(item => item.id === instanceId);
  if (!instance) throw new Error("O número selecionado não está conectado ou não está disponível para esta chave.");
  return instance;
}

export async function contactForChatInstance(contact: { id: string; name: string | null; phone: string | null; is_active: boolean; instance_id: string | null }, instanceId: string) {
  if (!contact.phone) throw new Error("Telefone não informado.");
  if (contact.instance_id === instanceId) return contact;
  const phone = contact.phone.replace(/\D/g, "");
  const find = async () => (await chatList<typeof contact>(`/v1/contacts?phone=${encodeURIComponent(phone)}&is_active=true`))
    .filter(candidate => candidate.phone?.replace(/\D/g, "") === phone);
  const candidates = await find();
  const existing = candidates.find(candidate => candidate.instance_id === instanceId);
  if (existing) return existing;
  try {
    const result = await chatRequest<{ data: typeof contact }>("/v1/contacts", { method: "POST", body: { name: contact.name ?? "Cliente", phone, instance_id: instanceId, source: "api" } });
    return result.data;
  } catch (error) {
    if (error instanceof ChatRequestError && error.status === 409) {
      const refreshed = await find();
      const raced = refreshed.find(candidate => candidate.instance_id === instanceId);
      if (raced) return raced;
      // Some Chat Jurídico deployments still reject the documented per-instance
      // duplicate. Creating a conversation with the existing sibling lets the
      // API resolve the contact for the requested instance safely.
      const sibling = refreshed[0] ?? candidates[0];
      if (sibling) return sibling;
    }
    throw error;
  }
}
export async function chatList<T>(path: string): Promise<T[]> {
  const rows: T[] = []; const seen = new Set<string>(); let cursor = "";
  for (let page = 0; page < 100; page++) {
    const result = await chatRequest<{ data: T[]; pagination?: { has_more: boolean; next_cursor: string | null } }>(`${path}${path.includes("?") ? "&" : "?"}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!Array.isArray(result.data)) throw new Error("Resposta de cobrança inválida.");
    rows.push(...result.data);
    if (!result.pagination?.has_more) return rows;
    cursor = result.pagination.next_cursor ?? "";
    if (!cursor || seen.has(cursor)) throw new Error("Não foi possível completar a paginação das cobranças.");
    seen.add(cursor);
  }
  throw new Error("Volume de cobranças excede o limite desta consulta. Nenhuma lista parcial foi liberada.");
}
