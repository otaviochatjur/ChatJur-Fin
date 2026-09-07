import { readIntegrationKey } from "./integrations-server";

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
  if (!response.ok) throw new Error(`Chat Jurídico retornou ${response.status}. Confira a chave, as permissões e o canal financeiro.`);
  return response.json() as Promise<T>;
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
