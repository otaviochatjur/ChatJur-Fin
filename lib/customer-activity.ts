import type { Subscription } from "./metrics";
import { z } from "zod";

export const activityLabels = { UPGRADE: "Upgrade de plano", DOWNGRADE: "Downgrade de plano", PERIOD_CHANGE: "Mudança de periodicidade", UPSELL: "Upsell", RENEWAL: "Renovação", DOWNSELL: "Downsell", CANCELLATION: "Cancelamento", REACTIVATION: "Reativação", FOLLOW_UP: "Acompanhamento" } as const;
export const itemCatalog = {
  INSTANCES: { label: "Instâncias", quantities: Array.from({ length: 10 }, (_, i) => i + 1) },
  USERS: { label: "Usuários", quantities: Array.from({ length: 30 }, (_, i) => i + 1) },
  ATTENDANCES: { label: "Atendimentos", quantities: Array.from({ length: 10 }, (_, i) => (i + 1) * 100) },
  AUTOMATIONS: { label: "Automações", quantities: Array.from({ length: 8 }, (_, i) => (i + 1) * 5) },
  OPEN_API: { label: "API aberta", quantities: [] },
  INTEGRATIONS: { label: "Integrações", quantities: [] },
} satisfies Record<string, { label: string; quantities: number[] }>;
const itemSchema = z.object({
  kind: z.enum(["INSTANCES", "USERS", "ATTENDANCES", "AUTOMATIONS", "OPEN_API", "INTEGRATIONS"]),
  quantity: z.number().int().nullable(),
  amount: z.number().finite().min(0).max(999999999).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use até duas casas decimais"),
}).superRefine((item, ctx) => {
  const quantities: number[] = itemCatalog[item.kind].quantities;
  if (quantities.length ? !quantities.includes(item.quantity as number) : item.quantity !== null) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantidade inválida para este item" });
});
export type ActivityItem = z.infer<typeof itemSchema>;
// Each amount is the total for the selected quantity, never a unit price.
export function itemsTotal(items: ActivityItem[]) {
  return items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100;
}
const planStateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  period: z.enum(["MONTHLY", "ANNUAL"]),
  value: z.number().finite().positive().max(999999999).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use até duas casas decimais"),
});
export const activitySchema = z.object({
  customerId: z.string().uuid(),
  type: z.enum(["UPGRADE", "DOWNGRADE", "PERIOD_CHANGE", "UPSELL", "RENEWAL", "DOWNSELL", "CANCELLATION", "REACTIVATION", "FOLLOW_UP"]),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Data inválida"),
  amount: z.number().finite().min(0).max(999999999).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use até duas casas decimais"),
  notes: z.string().trim().max(5000),
  items: z.array(itemSchema).max(6).optional(),
  // Which subscription an UPSELL/DOWNSELL applies to, so its value feeds the
  // MRR shown across the app (Visão Geral, Receita e MRR, repasses) the same
  // way an UPGRADE/DOWNGRADE does — see `effectiveSubscriptions`. Plan-change
  // types carry their own subscriptionId inside `planChange` instead.
  subscriptionId: z.string().uuid().optional(),
  planChange: z.object({ subscriptionId: z.string().uuid(), before: planStateSchema, after: planStateSchema }).optional(),
}).superRefine((value, ctx) => {
  const changesPlan = ["UPGRADE", "DOWNGRADE", "PERIOD_CHANGE"].includes(value.type);
  const itemized = ["UPSELL", "DOWNSELL"].includes(value.type);
  if (changesPlan !== Boolean(value.planChange)) ctx.addIssue({ code: "custom", message: "Informe os planos anterior e novo para esta mudança" });
  if (value.planChange) {
    const { before, after } = value.planChange;
    if (value.amount !== after.value) ctx.addIssue({ code: "custom", message: "Informe o novo valor integral" });
    if (value.type === "PERIOD_CHANGE" && (before.period === after.period || before.name !== after.name)) ctx.addIssue({ code: "custom", message: "Para trocar apenas a periodicidade, mantenha o plano e altere o ciclo" });
    if (value.type !== "PERIOD_CHANGE" && before.name === after.name) ctx.addIssue({ code: "custom", message: "Selecione um plano diferente para upgrade ou downgrade" });
  }
  if (value.items !== undefined) {
    if (!itemized || !value.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Selecione os itens do upsell ou downsell" });
    if (new Set(value.items.map(item => item.kind)).size !== value.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Não repita o mesmo item" });
    if (Math.round(value.amount * 100) !== Math.round(itemsTotal(value.items) * 100)) ctx.addIssue({ code: "custom", path: ["amount"], message: "O total deve corresponder à soma dos itens" });
  }
  if (itemized !== Boolean(value.subscriptionId)) ctx.addIssue({ code: "custom", path: ["subscriptionId"], message: "Selecione a assinatura afetada por este upsell ou downsell" });
  if (["UPSELL", "RENEWAL", "DOWNSELL", "REACTIVATION"].includes(value.type) && value.amount <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Informe o valor contratado" });
  if (["FOLLOW_UP", "CANCELLATION"].includes(value.type) && value.amount !== 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Este registro não possui valor contratado" });
  if (value.type === "CANCELLATION" && !value.notes.length) ctx.addIssue({ code: "custom", path: ["notes"], message: "Informe o motivo do cancelamento" });
});
export type CustomerActivity = z.infer<typeof activitySchema> & { id: string; createdAt: string };
export function localDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
export function summarizeActivities(events: CustomerActivity[]) {
  const ofType = (type: CustomerActivity["type"]) => events.filter(event => event.type === type);
  const sum = (type: CustomerActivity["type"]) => ofType(type).reduce((total, event) => total + Math.round(event.amount * 100), 0) / 100;
  return {
    upsells: ofType("UPSELL").length, upsellValue: sum("UPSELL"), renewals: ofType("RENEWAL").length, renewalValue: sum("RENEWAL"), downsells: ofType("DOWNSELL").length,
    cancellations: ofType("CANCELLATION").length, downsellValue: sum("DOWNSELL"), upgrades: ofType("UPGRADE").length, downgrades: ofType("DOWNGRADE").length,
    reactivations: ofType("REACTIVATION").length, reactivationValue: sum("REACTIVATION"),
    periodChanges: events.filter(e => e.planChange && e.planChange.before.period !== e.planChange.after.period).length,
    annualToMonthly: events.filter(e => e.planChange?.before.period === "ANNUAL" && e.planChange.after.period === "MONTHLY").length,
    monthlyToAnnual: events.filter(e => e.planChange?.before.period === "MONTHLY" && e.planChange.after.period === "ANNUAL").length,
    planMrrDelta: Math.round(events.reduce((sum, e) => sum + planMrrDelta(e.planChange), 0) * 100) / 100,
    // Upsells/downsells applied to a subscription (see `effectiveSubscriptions`) affect MRR too, separate from plan-change deltas above.
    itemizedMrrDelta: Math.round(events.reduce((sum, e) => sum + itemizedMrrDelta(e), 0) * 100) / 100,
    totalMrrDelta: Math.round(events.reduce((sum, e) => sum + planMrrDelta(e.planChange) + itemizedMrrDelta(e), 0) * 100) / 100,
  };
}

export function planMrrDelta(change: CustomerActivity["planChange"]) {
  if (!change) return 0;
  return change.after.value / (change.after.period === "ANNUAL" ? 12 : 1) - change.before.value / (change.before.period === "ANNUAL" ? 12 : 1);
}

/** MRR impact of a single UPSELL/DOWNSELL event: `amount` is entered (and displayed) as a monthly-equivalent value, so it applies directly regardless of the affected subscription's billing period — the conversion to the subscription's native `value` unit happens in `effectiveSubscriptions`. */
export function itemizedMrrDelta(event: Pick<CustomerActivity, "type" | "amount">) {
  if (event.type === "UPSELL") return event.amount;
  if (event.type === "DOWNSELL") return -event.amount;
  return 0;
}

export type ActiveCustomization = { kind: ActivityItem["kind"]; quantity: number | null; amount: number };

/**
 * Net add-ons still in effect for one subscription as of `on`: sums every
 * UPSELL (+) and DOWNSELL (-) item by kind, so e.g. "+5 usuários" followed
 * later by "-5 usuários" nets to nothing (not shown), while "+5" then
 * "+10" nets to "+15" (one combined entry). Used to flag a subscription as
 * "personalizado" relative to its base plan — see `hasCustomizations`.
 */
export function activeCustomizations(subscriptionId: string, customerId: string, events: CustomerActivity[], on = localDate()): ActiveCustomization[] {
  const totals = new Map<ActivityItem["kind"], { quantity: number; amount: number; hasQuantity: boolean }>();
  for (const event of events) {
    if (event.occurredOn > on || event.subscriptionId !== subscriptionId || event.customerId !== customerId) continue;
    if (event.type !== "UPSELL" && event.type !== "DOWNSELL") continue;
    const sign = event.type === "UPSELL" ? 1 : -1;
    for (const item of event.items ?? []) {
      const current = totals.get(item.kind) ?? { quantity: 0, amount: 0, hasQuantity: item.quantity !== null };
      current.quantity += sign * (item.quantity ?? 0);
      current.amount += sign * item.amount;
      if (item.quantity !== null) current.hasQuantity = true;
      totals.set(item.kind, current);
    }
  }
  const result: ActiveCustomization[] = [];
  for (const [kind, totalForKind] of totals) {
    const amount = Math.round(totalForKind.amount * 100) / 100;
    const quantity = totalForKind.hasQuantity ? totalForKind.quantity : null;
    if (Math.abs(amount) < 0.005 && (quantity === null || quantity === 0)) continue; // fully undone by a later downsell — no longer a customization
    result.push({ kind, quantity, amount });
  }
  return result;
}

export function effectiveSubscriptions(subscriptions: Subscription[], events: CustomerActivity[], on = localDate()) {
  const due = events.filter(e => e.occurredOn <= on);
  const planEvents = due.filter(e => e.planChange).sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt));
  const itemizedEvents = due.filter(e => e.subscriptionId && (e.type === "UPSELL" || e.type === "DOWNSELL"));
  return subscriptions.map(subscription => {
    const planEvent = planEvents.filter(e => e.planChange?.subscriptionId === subscription.id && e.customerId === subscription.customer_id).at(-1);
    const next = planEvent?.planChange?.after;
    const billingPeriod = next?.period ?? subscription.billing_period;
    const baseValue = next?.value ?? subscription.value;
    const monthlyDelta = itemizedEvents
      .filter(e => e.subscriptionId === subscription.id && e.customerId === subscription.customer_id)
      .reduce((sum, e) => sum + itemizedMrrDelta(e), 0);
    if (!next && monthlyDelta === 0) return subscription;
    // `value` is a monthly face value for MONTHLY plans and a yearly total for ANNUAL ones (see `monthlyValue`); upsell/downsell amounts are always entered as the monthly-equivalent delta, so an ANNUAL subscription needs that delta scaled back up by 12 before adding it to the yearly total.
    const value = Math.round((baseValue + (billingPeriod === "ANNUAL" ? monthlyDelta * 12 : monthlyDelta)) * 100) / 100;
    return { ...subscription, plan_id: next ? null : subscription.plan_id, custom_plan_id: next ? null : subscription.custom_plan_id, plan_name_raw: next?.name ?? subscription.plan_name_raw, billing_period: billingPeriod, value };
  });
}
