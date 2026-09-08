import type { AsaasCustomer, AsaasPayment } from "./asaas";
import { supabaseRequest } from "./supabase-server";
import { collectionSchedule, dayDistance } from "./collection-policy";
import { rulesForCustomer } from "./collection-rules";
import type { CollectionReport, ReportSnapshot } from "./collection-report-types";

export async function advanceBaseReport(report: CollectionReport) {
  const rows = await supabaseRequest<{ external_id: string; payload: AsaasPayment; customer_payload: AsaasCustomer | null }[]>(`/rest/v1/asaas_base_payments?generation=eq.${report.source_generation}&select=external_id,payload,customer_payload&order=external_id.asc&limit=1000${report.source_cursor ? `&external_id=gt.${encodeURIComponent(report.source_cursor)}` : ""}`);
  const snapshots = rows.map(({ payload: p, customer_payload: c }): ReportSnapshot => {
    const days = p.dueDate ? dayDistance(report.report_date, p.dueDate) : NaN;
    return { payment_id: p.id, customer_id: p.customer, name: c?.name ?? "Cliente não identificado", email: c?.email ?? "", phone: c?.mobilePhone ?? c?.phone ?? "", status: p.status, value: p.value, due_date: p.dueDate ?? null, description: p.description ?? "", billing_type: p.billingType ?? "", days: Number.isFinite(days) ? days : null, ...collectionSchedule(p.dueDate ?? null, report.report_date, rulesForCustomer(report.rule_config, p.customer)), invoice_url: null, bankslip_url: null, pix_payload: null, pix_image: null, pix_expiration: null, warnings: c ? [] : ["Cadastro do cliente indisponível na base sincronizada"] };
  });
  if (rows.length) await supabaseRequest("/rest/v1/collection_report_rows?on_conflict=tenant_id,report_id,asaas_payment_id", { method: "POST", prefer: "resolution=merge-duplicates", body: snapshots.map(snapshot => ({ report_id: report.id, asaas_payment_id: snapshot.payment_id, snapshot })) });
  const complete = rows.length < 1000;
  const [updated] = await supabaseRequest<CollectionReport[]>(`/rest/v1/collection_reports?id=eq.${report.id}&status=eq.RUNNING&page_offset=eq.${report.page_offset}`, { method: "PATCH", prefer: "return=representation", body: { source_cursor: rows.at(-1)?.external_id ?? report.source_cursor ?? null, page_offset: report.page_offset + rows.length, processed: report.processed + rows.length, row_count: report.row_count + rows.length, status: complete ? "COMPLETE" : "RUNNING", completed_at: complete ? new Date().toISOString() : null, error: null } });
  return updated ?? (await supabaseRequest<CollectionReport[]>(`/rest/v1/collection_reports?id=eq.${report.id}&select=*`))[0];
}
