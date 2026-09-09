import { readIntegrationKey } from "./integrations-server";

export type ChatInstance = { id: string; name: string | null; phone_id: string | null; display_phone_number: string | null; is_connected: boolean; api_provider?: string | null; approved_template_count?: number; approved_template_names?: string[] };
export type ChatConversation = { id: string; instance_id: string; contact_id: string; phone?: string | null };
export class ChatRequestError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: Record<string, unknown>, public retryAfterMs?: number) { super(message); }
}

function retryAfterMs(response: Response) {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)) return Math.ceil(Number(retryAfter) * 1000);
  const reset = response.headers.get("X-RateLimit-Reset");
  if (reset && /^\d+$/.test(reset)) return Math.max(1000, Number(reset) * 1000 - Date.now() + 1000);
  return undefined;
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
    throw new ChatRequestError(payload?.error?.message ?? `Chat Jurídico retornou ${response.status}. Confira a chave e as permissões.`, response.status, payload?.error?.code, payload?.error, retryAfterMs(response));
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

export function chatPhoneVariants(value: string) {
  const phone = value.replace(/\D/g, "");
  const variants = new Set([phone]);
  if (phone.startsWith("55") && phone.length === 13 && phone[4] === "9") variants.add(`${phone.slice(0, 4)}${phone.slice(5)}`);
  if (phone.startsWith("55") && phone.length === 12) variants.add(`${phone.slice(0, 4)}9${phone.slice(4)}`);
  return [...variants].filter(Boolean);
}

export function sameChatPhone(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false;
  const rightVariants = new Set(chatPhoneVariants(right));
  return chatPhoneVariants(left).some(value => rightVariants.has(value));
}

async function contactsForPhone<T extends { id: string; phone: string | null }>(phone: string) {
  const pages = await Promise.all(chatPhoneVariants(phone).map(value => chatList<T>(`/v1/contacts?phone=${encodeURIComponent(value)}&is_active=true`)));
  const unique = new Map<string, T>();
  for (const contact of pages.flat()) if (sameChatPhone(contact.phone, phone)) unique.set(contact.id, contact);
  return [...unique.values()];
}

export async function conversationForChatInstance(phone: string, instanceId: string) {
  const pages = await Promise.all(chatPhoneVariants(phone).map(value => chatList<ChatConversation>(`/v1/conversations?search=${encodeURIComponent(value)}&instance_id=${encodeURIComponent(instanceId)}`)));
  return pages.flat().find(conversation => conversation.instance_id === instanceId && sameChatPhone(conversation.phone, phone)) ?? null;
}

function isDuplicateResource(error: unknown) {
  return error instanceof ChatRequestError && (error.status === 409 || error.code === "duplicate_resource" || /(?:already exists|já existe)/i.test(error.message));
}

export async function contactForChatInstance(contact: { id: string; name: string | null; phone: string | null; is_active: boolean; instance_id: string | null }, instanceId: string) {
  if (!contact.phone) throw new Error("Telefone não informado.");
  const phone = contact.phone.replace(/\D/g, "");
  if (contact.instance_id === instanceId && sameChatPhone(contact.phone, phone)) return contact;
  const find = async () => contactsForPhone<typeof contact>(phone);
  const candidates = await find();
  const existing = candidates.find(candidate => candidate.instance_id === instanceId);
  if (existing) return existing;
  try {
    const result = await chatRequest<{ data: typeof contact }>("/v1/contacts", { method: "POST", body: { name: contact.name ?? "Cliente", phone, instance_id: instanceId, source: "api" } });
    return result.data;
  } catch (error) {
    if (isDuplicateResource(error)) {
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

export async function openChatConversation(contact: { id: string; name: string | null; phone: string | null; is_active: boolean; instance_id: string | null }, instanceId: string, idempotencyKey: string) {
  if (!contact.phone) throw new Error("Telefone não informado.");
  const existing = await conversationForChatInstance(contact.phone, instanceId);
  if (existing) return existing;
  const recipient = await contactForChatInstance(contact, instanceId);
  try {
    const { data } = await chatRequest<{ data: ChatConversation }>("/v1/conversations", { method: "POST", idempotencyKey, body: { contact_id: recipient.id, instance_id: instanceId } });
    return data;
  } catch (error) {
    if (isDuplicateResource(error)) {
      const recovered = await conversationForChatInstance(contact.phone, instanceId);
      if (recovered) return recovered;
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
