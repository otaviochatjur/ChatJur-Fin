import { requireUser, sameOrigin } from "@/lib/auth-server";
import { supabaseRequest } from "@/lib/supabase-server";
import { advanceCollectionReport, createCollectionReport, readCollectionReport, reportRows } from "@/lib/collection-reports-server";
import type { CollectionReport, ReportMode } from "@/lib/collection-report-types";
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
      const statuses = new Map<string, "ACTIVE" | "CANCELLED" | "FROZEN" | null>();
      for (let offset = 0; offset < customerIds.length; offset += 100) {
        const page = await supabaseRequest<{ asaas_customer_id: string; status: "ACTIVE" | "CANCELLED" | "FROZEN" | null }[]>(`/rest/v1/customers?select=asaas_customer_id,status&asaas_customer_id=in.(${customerIds.slice(offset, offset + 100).map(value => `"${value}"`).join(",")})`);
        for (const customer of page) if (!statuses.has(customer.asaas_customer_id)) statuses.set(customer.asaas_customer_id, customer.status);
      }
      const enriched = rows.map(row => ({ ...row, customer_found: statuses.has(row.snapshot.customer_id), customer_status: statuses.get(row.snapshot.customer_id) }));
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
