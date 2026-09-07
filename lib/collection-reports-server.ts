import { readCollectionSettings } from "./collection-settings-server";
import { rulesForCustomer } from "./collection-rules";
import { getAsaasConfig, type AsaasCustomer, type AsaasPayment } from "./asaas";
import { supabaseRequest } from "./supabase-server";
import { collectionSchedule, collectionToday, dayDistance } from "./collection-policy";
import { isCollectionBusinessDay } from "./collection-calendar";
import type { CollectionReport, ReportMode, ReportRow, ReportSnapshot } from "./collection-report-types";

type SourcePayment = AsaasPayment & { invoiceUrl?: string; bankSlipUrl?: string };
async function sourceReader() {
  const config = await getAsaasConfig();
  if (!config) throw new Error("Cadastre a chave do Asaas em Integrações para gerar relatórios.");
  return async function read<T>(path: string): Promise<T> {
    const r = await fetch(`${config.baseUrl}${path}`, { headers: { access_token: config.apiKey, "User-Agent": "Nexo/1.0" }, redirect: "manual", signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (!r.ok) throw new Error(`Asaas retornou ${r.status}. Confira a conexão e tente retomar o relatório.`);
    return r.json() as Promise<T>;
  };
}
async function parallel<T,R>(items: T[], action: (item: T) => Promise<R>) {
  const result: R[] = [];
  for (let i = 0; i < items.length; i += 5) result.push(...await Promise.all(items.slice(i,i+5).map(action)));
  return result;
}
export async function createCollectionReport(mode: ReportMode) {
  await sourceReader();
  const ruleConfig = await readCollectionSettings();
  const today = collectionToday(); const empty = mode === "DAILY" && !isCollectionBusinessDay(today);
  const [report] = await supabaseRequest<CollectionReport[]>("/rest/v1/collection_reports", { method: "POST", prefer: "return=representation", body: { mode, rule_config: ruleConfig, report_date: today, status: empty ? "COMPLETE" : "RUNNING", completed_at: empty ? new Date().toISOString() : null } });
  return report;
}
export async function readCollectionReport(id: string) {
  const [report] = await supabaseRequest<CollectionReport[]>(`/rest/v1/collection_reports?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!report) throw new Error("Relatório não encontrado nesta conta.");
  return report;
}
export async function reportRows(id: string) {
  const rows: ReportRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await supabaseRequest<ReportRow[]>(`/rest/v1/collection_report_rows?report_id=eq.${encodeURIComponent(id)}&select=*&order=id.asc&limit=500&offset=${offset}`);
    rows.push(...page); if (page.length < 500) return rows;
  }
}
export async function advanceCollectionReport(id: string) {
  const report = await readCollectionReport(id);
  if (report.status === "COMPLETE") return report;
  try {
    const read = await sourceReader();
    const statuses = report.mode === "ALL" ? [null] : ["PENDING", "OVERDUE"];
    const status = statuses[report.phase];
    const page = await read<{ data: SourcePayment[]; hasMore: boolean }>(`/payments?limit=25&offset=${report.page_offset}${status ? `&status=${status}` : ""}`);
    if (!Array.isArray(page.data) || typeof page.hasMore !== "boolean" || (page.hasMore && !page.data.length)) throw new Error("Asaas retornou uma página incompleta. Retome a consulta.");
    const selected = report.mode === "DAILY" ? page.data.filter(p => collectionSchedule(p.dueDate ?? null, report.report_date, rulesForCustomer(report.rule_config, p.customer)).stage) : page.data;
    const customerIds = [...new Set(selected.map(p => p.customer))];
    const customers = new Map(await parallel(customerIds, async customerId => {
      try { return [customerId, await read<AsaasCustomer>(`/customers/${encodeURIComponent(customerId)}`)] as const; }
      catch { return [customerId, null] as const; }
    }));
    const snapshots = await parallel(selected, async (payment): Promise<ReportSnapshot> => {
      const customer = customers.get(payment.customer); const warnings: string[] = [];
      if (!customer) warnings.push("Não foi possível consultar o cadastro no Asaas");
      const schedule = collectionSchedule(payment.dueDate ?? null, report.report_date, rulesForCustomer(report.rule_config, payment.customer));
      const days = payment.dueDate ? dayDistance(report.report_date, payment.dueDate) : NaN;
      if (!Number.isFinite(days)) warnings.push("Vencimento ausente ou inválido");
      const row: ReportSnapshot = { payment_id: payment.id, customer_id: payment.customer, name: customer?.name ?? "Cliente não identificado", email: customer?.email ?? "", phone: customer?.mobilePhone ?? customer?.phone ?? "", status: payment.status, value: payment.value, due_date: payment.dueDate ?? null, description: payment.description ?? "", billing_type: payment.billingType ?? "", days: Number.isFinite(days) ? days : null, ...schedule, invoice_url: report.mode === "ALL" ? null : payment.invoiceUrl ?? null, bankslip_url: report.mode === "ALL" ? null : payment.bankSlipUrl ?? null, pix_payload: null, pix_image: null, pix_expiration: null, warnings };
      if (report.mode !== "ALL" && ["PIX","BOLETO","UNDEFINED"].includes(payment.billingType ?? "")) {
        try {
          const pix = await read<{ payload?: string; encodedImage?: string; expirationDate?: string }>(`/payments/${encodeURIComponent(payment.id)}/pixQrCode`);
          row.pix_payload = pix.payload ?? null; row.pix_image = pix.encodedImage ?? null; row.pix_expiration = pix.expirationDate ?? null;
        } catch { warnings.push("Pix indisponível nesta consulta"); }
      }
      return row;
    });
    if (snapshots.length) await supabaseRequest("/rest/v1/collection_report_rows?on_conflict=tenant_id,report_id,asaas_payment_id", { method: "POST", prefer: "resolution=merge-duplicates", body: snapshots.map(snapshot => ({ report_id: report.id, asaas_payment_id: snapshot.payment_id, snapshot })) });
    const phase = page.hasMore ? report.phase : report.phase + 1;
    const complete = phase >= statuses.length;
    // Absolute progress + compare-and-set makes a repeated page safe to resume.
    const [updated] = await supabaseRequest<CollectionReport[]>(`/rest/v1/collection_reports?id=eq.${report.id}&status=eq.RUNNING&phase=eq.${report.phase}&page_offset=eq.${report.page_offset}`, { method: "PATCH", prefer: "return=representation", body: { phase, page_offset: page.hasMore ? report.page_offset + page.data.length : 0, processed: report.processed + page.data.length, row_count: complete ? (await reportRows(report.id)).length : report.row_count + snapshots.length, status: complete ? "COMPLETE" : "RUNNING", completed_at: complete ? new Date().toISOString() : null, error: null } });
    return updated ?? readCollectionReport(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível completar esta etapa.";
    await supabaseRequest(`/rest/v1/collection_reports?id=eq.${report.id}&status=eq.RUNNING`, { method: "PATCH", body: { error: message } });
    throw error;
  }
}
