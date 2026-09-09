import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { CollectionDispatchError, dispatchCollection } from "@/lib/collection-dispatch";
import { freshCollectionPreview } from "@/lib/collection-preview-server";
import { readCollectionSettings } from "@/lib/collection-settings-server";
import { collectionToday, type BillingTemplate, type CollectionPreview } from "@/lib/collection-policy";
import { requireUser, sameOrigin } from "@/lib/auth-server";
import { currentTenant } from "@/lib/tenant-server";
import { supabaseRequest } from "@/lib/supabase-server";
import { readCollectionReport, reportRows } from "@/lib/collection-reports-server";
import { chatRequest, requireConnectedChatInstance } from "@/lib/chat-juridico-server";

const paymentIdPattern = /^[A-Za-z0-9_-]{3,100}$/;

function approval(row: CollectionPreview, tenant: string, today: string) {
  const secret = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!secret) throw new Error("Proteção de integrações não configurada.");
  return createHmac("sha256", secret).update(JSON.stringify({ tenant, today, row })).digest("hex");
}

async function templates(instanceId: string) {
  const result = await chatRequest<{ data: BillingTemplate[] }>(`/v1/templates?instance_id=${encodeURIComponent(instanceId)}&status=APPROVED`);
  if (!Array.isArray(result.data)) throw new Error("Resposta de templates inválida.");
  return result.data;
}

async function prepare(reportId: string, instanceId: string, requestedIds: string[]) {
  if (!/^[a-f0-9-]{36}$/i.test(reportId)) throw new Error("Gere e selecione um relatório do Asaas primeiro.");
  if (!/^[a-f0-9-]{36}$/i.test(instanceId)) throw new Error("Escolha um número conectado do Chat Jurídico.");
  const paymentIds = [...new Set(requestedIds)];
  if (!paymentIds.length) throw new Error("Selecione ao menos uma cobrança apta no relatório.");
  if (paymentIds.length > 500 || paymentIds.some(id => !paymentIdPattern.test(id))) throw new Error("A seleção de cobranças é inválida.");

  await requireConnectedChatInstance(instanceId);
  const report = await readCollectionReport(reportId);
  const today = collectionToday();
  if (report.mode === "ALL") throw new Error("Use um relatório diário ou de cobranças em aberto para preparar mensagens.");
  if (report.status !== "COMPLETE" || report.report_date !== today) throw new Error("Prepare as mensagens a partir de um relatório concluído de hoje.");

  const selected = new Set(paymentIds);
  const snapshots = (await reportRows(reportId)).map(row => row.snapshot).filter(row => selected.has(row.payment_id));
  const availableIds = new Set(snapshots.map(row => row.payment_id));
  if (paymentIds.some(id => !availableIds.has(id))) throw new Error("Uma cobrança selecionada não pertence ao relatório aberto.");

  const [tenant, settings, availableTemplates] = await Promise.all([currentTenant(), readCollectionSettings(), templates(instanceId)]);
  const rows: CollectionPreview[] = [];
  for (let offset = 0; offset < paymentIds.length; offset += 5) {
    rows.push(...await Promise.all(paymentIds.slice(offset, offset + 5).map(id => freshCollectionPreview(id, instanceId, availableTemplates, settings, today))));
  }
  await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { id: randomUUID(), entity_type: "collection_review", entity_id: reportId, action: "PREPARED", after_json: { today, payment_ids: paymentIds, rows } } });
  return Response.json({ today, rows: rows.map(row => ({ ...row, approval: row.blocked ? undefined : approval(row, tenant.id, today) })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    const url = new URL(request.url);
    return await prepare(url.searchParams.get("reportId") ?? "", url.searchParams.get("instanceId") ?? "", url.searchParams.getAll("paymentId"));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível preparar a régua." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  const body = await request.json().catch(() => null);

  if (body?.action === "prepare") {
    if (typeof body.reportId !== "string" || typeof body.instanceId !== "string" || !Array.isArray(body.paymentIds) || body.paymentIds.some((id: unknown) => typeof id !== "string")) {
      return Response.json({ error: "Seleção de cobranças inválida." }, { status: 400 });
    }
    try { return await prepare(body.reportId, body.instanceId, body.paymentIds); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível preparar a régua." }, { status: 400 }); }
  }

  if (body?.approved !== true || typeof body.paymentId !== "string" || !paymentIdPattern.test(body.paymentId) || typeof body.instanceId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.instanceId) || typeof body.approval !== "string" || !/^[a-f0-9]{64}$/.test(body.approval)) {
    return Response.json({ error: "Aprove uma prévia válida e escolha o número antes de enviar." }, { status: 400 });
  }
  try {
    const tenant = await currentTenant();
    const today = collectionToday();
    await requireConnectedChatInstance(body.instanceId);
    const [settings, availableTemplates] = await Promise.all([readCollectionSettings(), templates(body.instanceId)]);
    const row = await freshCollectionPreview(body.paymentId, body.instanceId, availableTemplates, settings, today);
    const expected = approval(row, tenant.id, today);
    if (row.blocked || !timingSafeEqual(Buffer.from(body.approval), Buffer.from(expected))) {
      return Response.json({ error: "Os dados mudaram ou a prévia expirou. Prepare e revise novamente." }, { status: 409 });
    }
    const result = await dispatchCollection(row, today);
    return Response.json({ ok: true, skipped: result.skipped });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível enviar.", continueBatch: error instanceof CollectionDispatchError ? error.continueBatch : false, retryAfterMs: error instanceof CollectionDispatchError ? error.retryAfterMs : undefined }, { status: error instanceof CollectionDispatchError && error.retryAfterMs ? 429 : 400 });
  }
}
