export type TallyForm = { id: string; name: string; numberOfSubmissions: number };
export async function listTallyForms(apiKey: string): Promise<TallyForm[]> {
  const forms: TallyForm[] = [];
  for (let page = 1; page <= 100; page++) {
    const response = await fetch(`https://api.tally.so/forms?page=${page}&limit=500`, { headers: { Authorization: `Bearer ${apiKey}` }, redirect: "manual", signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Confira a chave de API e suas permissões no Tally." : `Não foi possível listar os formulários (${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data.items) || typeof data.hasMore !== "boolean" || (data.hasMore && !data.items.length)) throw new Error("O Tally retornou uma lista incompleta de formulários.");
    for (const form of data.items) {
      if (typeof form.id !== "string" || typeof form.name !== "string") throw new Error("Formulário inválido na resposta do Tally.");
      forms.push({ id: form.id, name: form.name, numberOfSubmissions: Number(form.numberOfSubmissions ?? 0) });
    }
    if (!data.hasMore) return forms;
  }
  throw new Error("A lista de formulários ultrapassou o limite da consulta.");
}
