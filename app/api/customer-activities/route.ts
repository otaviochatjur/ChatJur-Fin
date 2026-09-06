import { readCustomerActivities } from "@/lib/customer-activity-server";
import { effectiveSubscriptions } from "@/lib/customer-activity";
import type { Subscription } from "@/lib/metrics";
import { activitySchema, type CustomerActivity } from "@/lib/customer-activity";
import { supabaseRequest } from "@/lib/supabase-server";
import type { z } from "zod";

type StoredActivity = { id: string; created_at: string; after_json: Omit<CustomerActivity, "id" | "createdAt"> };

export async function GET() {
  try {
    const events = await readCustomerActivities();
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao carregar acompanhamento." }, { status: 500 });
  }
}

/** Shared validation for create and edit: confirms the customer exists and, for plan-change or itemized (upsell/downsell) events, that the referenced subscription is real, active and belongs to this customer. `excludeEventId` lets an edit ignore its own prior version when checking for conflicting later plan changes. */
async function validatePayload(payload: z.infer<typeof activitySchema>, excludeEventId?: string) {
  const customers = await supabaseRequest<{ id: string }[]>(`/rest/v1/customers?id=eq.${payload.customerId}&select=id`);
  if (!customers.length) return "Cliente não encontrado.";
  if (payload.planChange) {
    const change = payload.planChange;
    const base = await supabaseRequest<Subscription[]>(`/rest/v1/subscriptions?id=eq.${change.subscriptionId}&customer_id=eq.${payload.customerId}&status=eq.ACTIVE&select=*`);
    if (!base.length) return "Assinatura ativa não encontrada para este cliente.";
    const events = (await readCustomerActivities()).filter((e) => e.id !== excludeEventId);
    if (events.some((e) => e.planChange?.subscriptionId === change.subscriptionId && e.occurredOn >= payload.occurredOn)) return "Já existe uma mudança nesta data ou posterior. Use uma data após a última mudança registrada.";
    const [current] = effectiveSubscriptions(base, events, payload.occurredOn);
    if ((current.plan_name_raw ?? "Plano") !== change.before.name || current.billing_period !== change.before.period || Number(current.value) !== change.before.value) return "A assinatura mudou. Reabra o cliente para atualizar os dados.";
  }
  if (payload.subscriptionId && (payload.type === "UPSELL" || payload.type === "DOWNSELL")) {
    const base = await supabaseRequest<{ id: string }[]>(`/rest/v1/subscriptions?id=eq.${payload.subscriptionId}&customer_id=eq.${payload.customerId}&status=eq.ACTIVE&select=id`);
    if (!base.length) return "Assinatura ativa não encontrada para este cliente.";
  }
  return null;
}

export async function POST(request: Request) {
  const parsed = activitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    const payload = parsed.data;
    const error = await validatePayload(payload);
    if (error) return Response.json({ error }, { status: error === "Cliente não encontrado." ? 404 : 400 });
    const [row] = await supabaseRequest<StoredActivity[]>("/rest/v1/audit_events", {
      method: "POST", prefer: "return=representation",
      body: { entity_type: "customer_activity", entity_id: payload.customerId, action: payload.type, after_json: payload },
    });
    return Response.json({ event: { ...row.after_json, id: row.id, createdAt: row.created_at } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao salvar acompanhamento." }, { status: 500 });
  }
}

/** Operators can correct a mistaken entry (wrong amount, date, subscription…) without losing the record's id or original createdAt. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as (Record<string, unknown> & { id?: unknown }) | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return Response.json({ error: "Informe o registro a editar." }, { status: 400 });
  // `activitySchema` isn't `.strict()`, so the extra `id` field above is silently dropped from `parsed.data`.
  const parsed = activitySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    const [existing] = await supabaseRequest<{ id: string }[]>(`/rest/v1/audit_events?id=eq.${id}&entity_type=eq.customer_activity&select=id`);
    if (!existing) return Response.json({ error: "Registro não encontrado." }, { status: 404 });
    const payload = parsed.data;
    const error = await validatePayload(payload, id);
    if (error) return Response.json({ error }, { status: error === "Cliente não encontrado." ? 404 : 400 });
    const [row] = await supabaseRequest<StoredActivity[]>(`/rest/v1/audit_events?id=eq.${id}`, {
      method: "PATCH", prefer: "return=representation",
      body: { entity_id: payload.customerId, action: payload.type, after_json: payload },
    });
    return Response.json({ event: { ...row.after_json, id: row.id, createdAt: row.created_at } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao editar registro." }, { status: 500 });
  }
}

/** Operators can remove a wrong entry entirely; this only deletes the activity log row, never touches subscriptions or payments. */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id é obrigatório." }, { status: 400 });
  try {
    const [existing] = await supabaseRequest<{ id: string }[]>(`/rest/v1/audit_events?id=eq.${id}&entity_type=eq.customer_activity&select=id`);
    if (!existing) return Response.json({ error: "Registro não encontrado." }, { status: 404 });
    await supabaseRequest(`/rest/v1/audit_events?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao excluir registro." }, { status: 500 });
  }
}
