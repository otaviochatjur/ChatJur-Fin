import { requireUser, sameOrigin } from "@/lib/auth-server";
import { supabaseRequest } from "@/lib/supabase-server";
import { advanceCollectionReport, createCollectionReport, readCollectionReport, reportRows } from "@/lib/collection-reports-server";
import type { CollectionReport, ReportMode } from "@/lib/collection-report-types";
import { customersByAsaasIds } from "@/lib/customer-asaas-aliases";
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id);
export async function GET(request: Request) {
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id) {
      if (!validId(id)) return Response.json({ error: "Relatório inválido." }, { status: 400 });
      const [report, rows, reviews] = await Promise.all([readCollectionReport(id), reportRows(id), supabaseRequest<{ after_json: unknown }[]>(`/rest/v1/audit_events?entity_type=eq.collection_review&entity_id=eq.${id}&order=created_at.desc&limit=1&select=after_json`)]);
      const customerIds = [...new Set(rows.map(row => row.snapshot.customer_id).filter(customerId => /^[A-Za-z0-9_-]+$/.test(customerId)))];
      const sentParams = new URLSearchParams({ entity_type: "eq.collection_send", action: "eq.SENT", select: "entity_id,created_at,after_json", order: "created_at.desc", limit: "500" });
      sentParams.set("after_json->>date", `eq.${report.report_date}`);
      const [customers, sentEvents] = await Promise.all([
        customersByAsaasIds(customerIds),
        supabaseRequest<{ entity_id: string; created_at: string; after_json: { sent_at?: string; stage?: string; payment?: { asaas_payment_id?: string; id?: string } } }[]>(`/rest/v1/audit_events?${sentParams}`),
      ]);
      const sentByPayment = new Map<string, { at: string; stage: string | null }>();
      for (const event of sentEvents) {
        const paymentId = event.after_json.payment?.asaas_payment_id ?? event.after_json.payment?.id ?? event.entity_id;
        if (!sentByPayment.has(paymentId)) sentByPayment.set(paymentId, { at: event.after_json.sent_at ?? event.created_at, stage: event.after_json.stage ?? null });
      }
      const enriched = rows.map(row => ({ ...row, internal_customer_id: customers.get(row.snapshot.customer_id)?.id ?? null, customer_found: customers.has(row.snapshot.customer_id), customer_status: customers.get(row.snapshot.customer_id)?.status, sent_today_at: sentByPayment.get(row.snapshot.payment_id)?.at ?? null, sent_today_stage: sentByPayment.get(row.snapshot.payment_id)?.stage ?? null }));
      return Response.json({ report, rows: enriched, review: reviews[0]?.after_json ?? null }, { headers: { "Cache-Control": "no-store" } });
    }
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    const reports = await supabaseRequest<CollectionReport[]>(`/rest/v1/collection_reports?select=*&order=created_at.desc&limit=100&offset=${Math.floor(offset)}`);
    return Response.json({ reports }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha ao ler relatórios." }, { status: 400 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  const body = await request.json().catch(() => null);
  try {
    if (body?.action === "advance" && validId(body.id)) return Response.json({ report: await advanceCollectionReport(body.id) });
    if (body?.action === "create" && ["DAILY","OPEN","ALL"].includes(body.mode)) return Response.json({ report: await createCollectionReport(body.mode as ReportMode) });
    return Response.json({ error: "Escolha um tipo de relatório." }, { status: 400 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha ao gerar relatório." }, { status: 400 }); }
}
