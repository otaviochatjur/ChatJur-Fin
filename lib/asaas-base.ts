import { randomUUID } from "node:crypto";
import { getAsaasConfig, type AsaasPayment } from "./asaas";
import { supabaseRequest, finishAsaasBaseSync } from "./supabase-server";

export type AsaasBaseState = { generation: string; active_generation: string | null; status: "RUNNING" | "READY"; phase: number; page_offset: number; processed: number; started_at: string; completed_at: string | null; last_event_at: string | null; error: string | null };
type ObjectData = { id: string; [key: string]: unknown };
export async function baseReader() {
  const config = await getAsaasConfig();
  if (!config) throw new Error("Cadastre sua chave do Asaas em Integrações.");
  return async <T>(path: string, allowMissing = false): Promise<T | null> => {
    const response = await fetch(`${config.baseUrl}${path}`, { headers: { access_token: config.apiKey, "User-Agent": "Nexo/1.0" }, redirect: "manual", signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Asaas respondeu ${response.status}. A sincronização pode ser retomada.`);
    return response.json() as Promise<T>;
  };
}
export async function readAsaasBaseState() {
  return (await supabaseRequest<AsaasBaseState[]>("/rest/v1/asaas_base_sync?select=*&limit=1"))[0] ?? null;
}
export async function startAsaasBaseSync(force = true) {
  const current = await readAsaasBaseState();
  if (current?.status === "RUNNING") return current;
  if (!force && current?.completed_at && Date.now() - Date.parse(current.completed_at) < 3600000) return current;
  await baseReader();
  const body = { generation: randomUUID(), status: "RUNNING", phase: 0, page_offset: 0, processed: 0, started_at: new Date().toISOString(), error: null };
  const rows = await supabaseRequest<AsaasBaseState[]>(current ? "/rest/v1/asaas_base_sync?status=eq.READY" : "/rest/v1/asaas_base_sync?on_conflict=tenant_id", { method: current ? "PATCH" : "POST", prefer: current ? "return=representation" : "resolution=ignore-duplicates,return=representation", body });
  return rows[0] ?? (await readAsaasBaseState())!;
}
async function saveObjects(generations: string[], kind: string, data: ObjectData[], observedAt: string) {
  if (!data.length) return;
  await supabaseRequest("/rest/v1/asaas_base_objects?on_conflict=tenant_id,generation,kind,external_id", { method: "POST", prefer: "resolution=merge-duplicates", body: generations.flatMap(generation => data.map(payload => ({ generation, kind, external_id: payload.id, payload, observed_at: observedAt }))) });
}
async function advanceAsaasBaseSyncOnce(generation: string) {
  const state = await readAsaasBaseState();
  if (!state || state.generation !== generation) throw new Error("A execução mudou. Atualize a tela.");
  if (state.status === "READY") return state;
  try {
    const read = await baseReader();
    const paths = ["customers", "payments", "paymentLinks"], kinds = ["CUSTOMER", "PAYMENT", "LINK"];
    const observedAt = new Date().toISOString();
    const page = await read<{ data: ObjectData[]; hasMore: boolean }>(`/${paths[state.phase]}?limit=100&offset=${state.page_offset}${state.phase === 2 ? "&includeDeleted=true" : ""}`);
    if (!page || !Array.isArray(page.data) || typeof page.hasMore !== "boolean" || (page.hasMore && !page.data.length) || page.data.some(row => typeof row.id !== "string")) throw new Error("Página incompleta recebida do Asaas.");
    await saveObjects([generation], kinds[state.phase], page.data, observedAt);
    const last = state.phase === 2 && !page.hasMore;
    const [updated] = await supabaseRequest<AsaasBaseState[]>(`/rest/v1/asaas_base_sync?generation=eq.${generation}&status=eq.RUNNING&phase=eq.${state.phase}&page_offset=eq.${state.page_offset}`, { method: "PATCH", prefer: "return=representation", body: { phase: last ? state.phase : page.hasMore ? state.phase : state.phase + 1, page_offset: last ? state.page_offset : page.hasMore ? state.page_offset + page.data.length : 0, processed: state.processed + page.data.length, error: null } });
    if (last) return finishAsaasBaseSync<AsaasBaseState>(generation, state.page_offset);
    return updated ?? (await readAsaasBaseState())!;
  } catch (e) {
    await supabaseRequest(`/rest/v1/asaas_base_sync?generation=eq.${generation}&status=eq.RUNNING`, { method: "PATCH", body: { error: e instanceof Error ? e.message : "Falha na sincronização." } });
    throw e;
  }
}

/** Read current remote state, so a delayed event cannot restore an obsolete payment status. */
export async function updateAsaasBasePayment(payment: AsaasPayment) {
  const state = await readAsaasBaseState();
  if (!state) return;
  const generations = [...new Set([state.active_generation, state.status === "RUNNING" ? state.generation : null].filter((id): id is string => Boolean(id)))];
  if (!generations.length) return;
  const read = await baseReader(), observedAt = new Date().toISOString();
  const latest = await read<ObjectData>(`/payments/${encodeURIComponent(payment.id)}`, true);
  await saveObjects(generations, "PAYMENT", [latest ?? { ...payment, deleted: true, status: "DELETED" }], observedAt);
  const customerId = String(latest?.customer ?? payment.customer);
  const customer = await read<ObjectData>(`/customers/${encodeURIComponent(customerId)}`, true);
  if (customer) await saveObjects(generations, "CUSTOMER", [customer], observedAt);
  await supabaseRequest("/rest/v1/asaas_base_sync", { method: "PATCH", body: { last_event_at: new Date().toISOString() } });
}

export async function advanceAsaasBaseSync(generation: string) {
  for (let attempt = 0; ; attempt++) {
    try { return await advanceAsaasBaseSyncOnce(generation); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (attempt >= 2 || !/fetch failed|timeout|timed out|429|502|503|504/i.test(message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
