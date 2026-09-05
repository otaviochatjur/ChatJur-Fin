import type { Subscription } from "./metrics";
import { z } from "zod";

export const activityLabels = { UPGRADE: "Upgrade de plano", DOWNGRADE: "Downgrade de plano", PERIOD_CHANGE: "Mudança de periodicidade", UPSELL: "Upsell", RENEWAL: "Renovação", DOWNSELL: "Downsell", CANCELLATION: "Cancelamento", FOLLOW_UP: "Acompanhamento" } as const;
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
  type: z.enum(["UPGRADE", "DOWNGRADE", "PERIOD_CHANGE", "UPSELL", "RENEWAL", "DOWNSELL", "CANCELLATION", "FOLLOW_UP"]),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Data inválida"),
  amount: z.number().finite().min(0).max(999999999).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use até duas casas decimais"),
  notes: z.string().trim().max(5000),
  items: z.array(itemSchema).max(6).optional(),
  planChange: z.object({ subscriptionId: z.string().uuid(), before: planStateSchema, after: planStateSchema }).optional(),
}).superRefine((value, ctx) => {
  const changesPlan = ["UPGRADE", "DOWNGRADE", "PERIOD_CHANGE"].includes(value.type);
  if (changesPlan !== Boolean(value.planChange)) ctx.addIssue({ code: "custom", message: "Informe os planos anterior e novo para esta mudança" });
  if (value.planChange) {
    const { before, after } = value.planChange;
    if (value.amount !== after.value) ctx.addIssue({ code: "custom", message: "Informe o novo valor integral" });
    if (value.type === "PERIOD_CHANGE" && (before.period === after.period || before.name !== after.name)) ctx.addIssue({ code: "custom", message: "Para trocar apenas a periodicidade, mantenha o plano e altere o ciclo" });
    if (value.type !== "PERIOD_CHANGE" && before.name === after.name) ctx.addIssue({ code: "custom", message: "Selecione um plano diferente para upgrade ou downgrade" });
  }
  if (value.items !== undefined) {
    if (!["UPSELL", "DOWNSELL"].includes(value.type) || !value.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Selecione os itens do upsell ou downsell" });
    if (new Set(value.items.map(item => item.kind)).size !== value.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Não repita o mesmo item" });
    if (Math.round(value.amount * 100) !== Math.round(itemsTotal(value.items) * 100)) ctx.addIssue({ code: "custom", path: ["amount"], message: "O total deve corresponder à soma dos itens" });
  }
  if (["UPSELL", "RENEWAL", "DOWNSELL"].includes(value.type) && value.amount <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Informe o valor contratado" });
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
  return { upsells: ofType("UPSELL").length, upsellValue: sum("UPSELL"), renewals: ofType("RENEWAL").length, renewalValue: sum("RENEWAL"), downsells: ofType("DOWNSELL").length, cancellations: ofType("CANCELLATION").length, downsellValue: sum("DOWNSELL"), upgrades: ofType("UPGRADE").length, downgrades: ofType("DOWNGRADE").length, periodChanges: events.filter(e => e.planChange && e.planChange.before.period !== e.planChange.after.period).length, annualToMonthly: events.filter(e => e.planChange?.before.period === "ANNUAL" && e.planChange.after.period === "MONTHLY").length, monthlyToAnnual: events.filter(e => e.planChange?.before.period === "MONTHLY" && e.planChange.after.period === "ANNUAL").length, planMrrDelta: Math.round(events.reduce((sum, e) => sum + planMrrDelta(e.planChange), 0) * 100) / 100 };
}

export function planMrrDelta(change: CustomerActivity["planChange"]) {
  if (!change) return 0;
  return change.after.value / (change.after.period === "ANNUAL" ? 12 : 1) - change.before.value / (change.before.period === "ANNUAL" ? 12 : 1);
}
export function effectiveSubscriptions(subscriptions: Subscription[], events: CustomerActivity[], on = localDate()) {
  const ordered = events.filter(e => e.planChange && e.occurredOn <= on).sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt));
  return subscriptions.map(subscription => {
    const event = ordered.filter(e => e.planChange?.subscriptionId === subscription.id && e.customerId === subscription.customer_id).at(-1);
    if (!event?.planChange) return subscription;
    const next = event.planChange.after;
    return { ...subscription, plan_id: null, custom_plan_id: null, plan_name_raw: next.name, billing_period: next.period, value: next.value };
  });
}
