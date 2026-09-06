import { readCustomerActivities } from "@/lib/customer-activity-server";
import { effectiveSubscriptions } from "@/lib/customer-activity";
import type { Subscription } from "@/lib/metrics";
import { activitySchema, type CustomerActivity } from "@/lib/customer-activity";
import { supabaseRequest } from "@/lib/supabase-server";

type StoredActivity = { id: string; created_at: string; after_json: Omit<CustomerActivity, "id" | "createdAt"> };

export async function GET() {
  try {
    const events = await readCustomerActivities();
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao carregar acompanhamento." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const parsed = activitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    const payload = parsed.data;
    const customers = await supabaseRequest<{ id: string }[]>(`/rest/v1/customers?id=eq.${payload.customerId}&select=id`);
    if (!customers.length) return Response.json({ error: "Cliente não encontrado." }, { status: 404 });
    if (payload.planChange) {
      const change = payload.planChange;
      const base = await supabaseRequest<Subscription[]>(`/rest/v1/subscriptions?id=eq.${change.subscriptionId}&customer_id=eq.${payload.customerId}&status=eq.ACTIVE&select=*`);
      if (!base.length) return Response.json({ error: "Assinatura ativa não encontrada para este cliente." }, { status: 400 });
      const events = await readCustomerActivities();
      if (events.some(e => e.planChange?.subscriptionId === change.subscriptionId && e.occurredOn >= payload.occurredOn)) return Response.json({ error: "Já existe uma mudança nesta data ou posterior. Use uma data após a última mudança registrada." }, { status: 409 });
      const [current] = effectiveSubscriptions(base, events, payload.occurredOn);
      if ((current.plan_name_raw ?? "Plano") !== change.before.name || current.billing_period !== change.before.period || Number(current.value) !== change.before.value) return Response.json({ error: "A assinatura mudou. Reabra o cliente para atualizar os dados." }, { status: 409 });
    }
    if (payload.subscriptionId && (payload.type === "UPSELL" || payload.type === "DOWNSELL")) {
      const base = await supabaseRequest<{ id: string }[]>(`/rest/v1/subscriptions?id=eq.${payload.subscriptionId}&customer_id=eq.${payload.customerId}&status=eq.ACTIVE&select=id`);
      if (!base.length) return Response.json({ error: "Assinatura ativa não encontrada para este cliente." }, { status: 400 });
    }
    const [row] = await supabaseRequest<StoredActivity[]>("/rest/v1/audit_events", {
      method: "POST", prefer: "return=representation",
      body: { entity_type: "customer_activity", entity_id: payload.customerId, action: payload.type, after_json: payload },
    });
    return Response.json({ event: { ...row.after_json, id: row.id, createdAt: row.created_at } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao salvar acompanhamento." }, { status: 500 });
  }
}
