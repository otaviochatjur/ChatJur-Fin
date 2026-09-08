import { dispatchCollection } from "@/lib/collection-dispatch";
import { rulesForCustomer } from "@/lib/collection-rules";
import { readCollectionSettings } from "@/lib/collection-settings-server";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { requireUser, sameOrigin } from "@/lib/auth-server";
import { currentTenant } from "@/lib/tenant-server";
import { supabaseRequest } from "@/lib/supabase-server";
import { readCollectionReport, reportRows } from "@/lib/collection-reports-server";
import { asaasRequest, type AsaasPayment } from "@/lib/asaas";
import { chatList, chatRequest } from "@/lib/chat-juridico-server";
import { canonicalBillingPayment, collectionToday, FINANCIAL_INSTANCE, previewCollection, type BillingPayment, type BillingContact, type BillingTemplate, type CollectionPreview } from "@/lib/collection-policy";

function approval(row: CollectionPreview, tenant: string, today: string) {
  const secret = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!secret) throw new Error("Proteção de integrações não configurada.");
  return createHmac("sha256", secret).update(JSON.stringify({ tenant, today, row })).digest("hex");
}
async function templates() {
  const result = await chatRequest<{ data: BillingTemplate[] }>(`/v1/templates?instance_id=${FINANCIAL_INSTANCE}&status=APPROVED`);
  if (!Array.isArray(result.data)) throw new Error("Resposta de templates inválida.");
  return result.data;
}
async function contact(id: string | null) {
  return id ? (await chatRequest<{ data: BillingContact }>(`/v1/contacts/${encodeURIComponent(id)}`)).data : null;
}
export async function GET(request: Request) {
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    const reportId = new URL(request.url).searchParams.get("reportId");
    if (!reportId || !/^[a-f0-9-]{36}$/i.test(reportId)) throw new Error("Gere e selecione um relatório do Asaas primeiro.");
    const report = await readCollectionReport(reportId);
    const tenant = await currentTenant(); const today = collectionToday();
    const settings = await readCollectionSettings();
    if (report.mode === "ALL") throw new Error("Use um relatório diário ou de cobranças em aberto para preparar mensagens.");
    if (report.status !== "COMPLETE" || report.report_date !== today) throw new Error("Prepare as mensagens a partir de um relatório concluído de hoje.");
    const snapshots = (await reportRows(reportId)).map(row => row.snapshot).filter(row => ["PENDING", "OVERDUE"].includes(row.status));
    if (!snapshots.length) {
      await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { id: randomUUID(), entity_type: "collection_review", entity_id: reportId, action: "PREPARED", after_json: { today, rows: [] } } });
      return Response.json({ today, rows: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const [overdue, pending, available] = await Promise.all([
      chatList<BillingPayment>("/v1/payments?status=OVERDUE"), chatList<BillingPayment>("/v1/payments?status=PENDING"), templates(),
    ]);
    const byAsaas = new Map<string, BillingPayment[]>();
    for (const raw of [...new Map([...overdue,...pending].map(p => [p.id,p])).values()]) {
      const p = canonicalBillingPayment(raw); if (!p.asaas_payment_id) continue;
      byAsaas.set(p.asaas_payment_id, [...(byAsaas.get(p.asaas_payment_id) ?? []), p]);
    }
    const contacts = new Map<string, BillingContact | null>();
    const ids = [...new Set(snapshots.flatMap(row => (byAsaas.get(row.payment_id) ?? []).map(p => p.contact_id)).filter((id): id is string => Boolean(id)))];
    for (let i = 0; i < ids.length; i += 5) await Promise.all(ids.slice(i, i + 5).map(async id => {
      try { contacts.set(id, await contact(id)); } catch { contacts.set(id,null); }
    }));
    const rows = snapshots.map(snapshot => {
      const matches = byAsaas.get(snapshot.payment_id) ?? [];
      const match = matches.length === 1 ? matches[0] : null;
      const p = canonicalBillingPayment({ id: match?.id ?? snapshot.payment_id, asaas_payment_id: snapshot.payment_id, contact_id: match?.contact_id ?? null, contact_name: snapshot.name, chat_id: match?.chat_id ?? null, due_date: snapshot.due_date, value: snapshot.value, status: snapshot.status, invoice_url: snapshot.invoice_url });
      const row = previewCollection(p, contacts.get(p.contact_id ?? "") ?? null, available, today, rulesForCustomer(settings, snapshot.customer_id));
      if (!match) row.blocked = matches.length > 1 ? "Mais de uma cobrança no Chat Jurídico para este pagamento" : "Pagamento do Asaas sem vínculo no Chat Jurídico";
      return row;
    });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { id: randomUUID(), entity_type: "collection_review", entity_id: reportId, action: "PREPARED", after_json: { today, rows } } });
    return Response.json({ today, rows: rows.map(row => ({ ...row, approval: row.blocked ? undefined : approval(row, tenant.id, today) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível preparar a régua." }, { status: 400 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  const body = await request.json().catch(() => null);
  if (body?.approved !== true || typeof body.paymentId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.paymentId) || typeof body.approval !== "string" || !/^[a-f0-9]{64}$/.test(body.approval)) return Response.json({ error: "Aprove uma prévia válida antes de enviar." }, { status: 400 });
  try {
    const tenant = await currentTenant(); const today = collectionToday();
    const settings = await readCollectionSettings();
    const { data: rawPayment } = await chatRequest<{ data: BillingPayment }>(`/v1/payments/${encodeURIComponent(body.paymentId)}`);
    const payment = canonicalBillingPayment(rawPayment);
    if (!payment.asaas_payment_id) throw new Error("Cobrança sem identificação do pagamento Asaas.");
    const source = await asaasRequest<AsaasPayment & { invoiceUrl?: string }>(`/payments/${encodeURIComponent(payment.asaas_payment_id)}`);
    const payer = await asaasRequest<{ name?: string }>(`/customers/${encodeURIComponent(source.customer)}`);
    payment.contact_name = payer.name ?? "Cliente não identificado";
    payment.status = source.status; payment.value = Number(source.value); payment.due_date = source.dueDate ?? null; payment.invoice_url = source.invoiceUrl ?? null;
    const row = previewCollection(payment, await contact(payment.contact_id), await templates(), today, rulesForCustomer(settings, source.customer));
    if (row.blocked || !timingSafeEqual(Buffer.from(body.approval), Buffer.from(approval(row, tenant.id, today)))) return Response.json({ error: "Os dados mudaram ou a prévia expirou. Atualize a régua e revise novamente." }, { status: 409 });
    const result = await dispatchCollection(row, today);
    if (result.skipped) return Response.json({ error: "Esta etapa já possui uma tentativa registrada. Confira o histórico." }, { status: 409 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível enviar." }, { status: 400 });
  }
}
