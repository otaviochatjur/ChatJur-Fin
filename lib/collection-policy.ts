export const FINANCIAL_INSTANCE = "46a8a400-70a2-43fd-bfeb-1e286871711b";
import { addCalendarDays, isCollectionBusinessDay, nextCollectionBusinessDay, type CollectionCalendar } from "./collection-calendar";
import { DEFAULT_COLLECTION_SETTINGS, type CollectionRule } from "./collection-rules";
export const COLLECTION_STAGES: Record<number, string> = { [-5]: "cobranca_d_menos_5", 0: "cobranca_d_000", 1: "cobranca_d_mais_01", 2: "cobranca_d_mais_002", 5: "cobranca_d_mais_5", 10: "cobranca_d_mais_10", 20: "cobranca_d_mais_20", 25: "cobranca_d_mais_025", 30: "cobranca_d_mais_30_cancelamento" };
export function collectionSchedule(due: string | null, today: string, rules: CollectionRule[] = DEFAULT_COLLECTION_SETTINGS.rules, calendar?: CollectionCalendar) {
  if (!due || !Number.isFinite(dayDistance(today, due))) return { stage: null, trigger: null, nominal: null, effective: null };
  if (isCollectionBusinessDay(today, calendar)) for (const rule of [...rules].sort((a,b) => a.days-b.days)) {
    const k = rule.days;
    const nominal = addCalendarDays(due, k), effective = nextCollectionBusinessDay(nominal, calendar);
    if (effective === today) return { stage: rule.template, trigger: k, nominal, effective };
  }
  return { stage: null, trigger: null, nominal: null, effective: null };
}
export function collectionToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function dayDistance(today: string, due: string) {
  const parsed = new Date(`${due}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== due) return NaN;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000);
}
export type BillingContact = { id: string; name: string | null; phone: string | null; is_active: boolean; instance_id: string | null; status?: "ACTIVE" | "CANCELLED" | "FROZEN" | null };
export type BillingPayment = { id: string; asaas_payment_id?: string | null; contact_id: string | null; contact_name: string | null; chat_id: string | null; due_date: string | null; value: number; status: string; invoice_url: string | null };
export function canonicalBillingPayment(p: BillingPayment & { asaas_id?: string | null }): BillingPayment {
  return { id: p.id, asaas_payment_id: p.asaas_payment_id ?? p.asaas_id ?? null, contact_id: p.contact_id ?? null, contact_name: p.contact_name ?? null, chat_id: p.chat_id ?? null, due_date: p.due_date ?? null, value: Number(p.value), status: p.status, invoice_url: p.invoice_url ?? null };
}
export type BillingTemplate = { name: string; language: string; status: string; instance_id: string; components: { type: string; text?: string; format?: string; buttons?: unknown[] }[] };
type CollectionParameterKind = "name" | "due_date" | "invoice_url";
const COLLECTION_PARAMETER_OVERRIDES: Record<string, CollectionParameterKind[]> = {
  cobranca_d_menos_5: ["name", "due_date", "invoice_url"],
  cobranca_d_menos_3: ["name", "invoice_url"],
  cobranca_d0: ["name", "due_date", "invoice_url"],
  cobranca_d_00: ["name", "due_date", "invoice_url"],
  cobranca_d_000: ["name", "due_date", "invoice_url"],
  cobranca_d_mais_1: ["name", "due_date", "invoice_url"],
  cobranca_d_mais_01: ["name", "due_date", "invoice_url"],
  cobranca_d_mais_2: ["name", "invoice_url"],
  cobranca_d_mais_02: ["name", "invoice_url"],
  cobranca_d_mais_002: ["name", "invoice_url"],
  cobranca_d_mais_5: ["name", "invoice_url"],
  cobranca_d_mais_10: ["name", "due_date", "invoice_url"],
  cobranca_d_mais_20: ["name", "invoice_url"],
  cobranca_d_mais_25: ["name", "invoice_url"],
  cobranca_d_mais_025: ["name", "invoice_url"],
  cobranca_d_mais_30_cancelamento: ["name"],
};
function inferredParameterKind(text: string, index: string): CollectionParameterKind | null {
  if (index === "1") return "name";
  const marker = new RegExp(`\\{\\{\\s*${index}\\s*\\}\\}`);
  const position = text.search(marker);
  if (position < 0) return null;
  const keywords: [CollectionParameterKind, RegExp][] = [
    ["due_date", /venc(?:e|imento)|data/gi],
    ["invoice_url", /link|acesse|acessar|regulariz|fatura\s+atrav[eé]s/gi],
  ];
  let best: { kind: CollectionParameterKind; distance: number } | null = null;
  for (const [kind, pattern] of keywords) for (const match of text.matchAll(pattern)) {
    const distance = Math.abs((match.index ?? 0) - position);
    if (!best || distance < best.distance) best = { kind, distance };
  }
  return best?.kind ?? null;
}
export function collectionTemplateParameterKind(templateName: string, text: string, index: string) {
  return COLLECTION_PARAMETER_OVERRIDES[templateName]?.[Number(index) - 1] ?? inferredParameterKind(text, index);
}
export function collectionTemplateCanPreview(template: BillingTemplate) {
  if (template.status !== "APPROVED" || template.language !== "pt_BR" || !Array.isArray(template.components)) return false;
  let hasText = false;
  for (const component of template.components) {
    const kind = component.type.toLowerCase();
    if (!["body", "header", "footer"].includes(kind) || (component.format && component.format !== "TEXT")) return false;
    const value = component.text ?? "";
    if (value) hasText = true;
    const variables = [...value.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => match[1]);
    if (variables.some(index => kind !== "body" || !["1", "2", "3"].includes(index))) return false;
  }
  return hasText;
}
export type CollectionPreview = { payment: BillingPayment; contact: BillingContact | null; instance_id: string; days: number | null; stage: string | null; text: string; parameters: Record<string, string>; language: string; blocked: string | null; approval?: string };
export function previewCollection(payment: BillingPayment, contact: BillingContact | null, templates: BillingTemplate[], today: string, rules: CollectionRule[] = DEFAULT_COLLECTION_SETTINGS.rules, calendar?: CollectionCalendar, senderInstanceId = FINANCIAL_INSTANCE): CollectionPreview {
  payment = canonicalBillingPayment(payment);
  contact = contact ? { id: contact.id, name: contact.name ?? null, phone: contact.phone ?? null, is_active: contact.is_active === true, instance_id: contact.instance_id ?? null, ...(contact.status !== undefined ? { status: contact.status } : {}) } : null;
  const days = payment.due_date ? dayDistance(today, payment.due_date) : NaN;
  const stage = collectionSchedule(payment.due_date, today, rules, calendar).stage;
  const row: CollectionPreview = { payment, contact, instance_id: senderInstanceId, days: Number.isFinite(days) ? days : null, stage, text: "", parameters: {}, language: "pt_BR", blocked: null };
  if (!["PENDING", "OVERDUE"].includes(payment.status)) row.blocked = "Cobrança não está em aberto";
  else if (!contact) row.blocked = "Cliente do Asaas ainda não sincronizado na base";
  else if (contact.status !== undefined && contact.status !== "ACTIVE") row.blocked = "Cliente sem status Ativo confirmado";
  else if (contact.is_active !== true) row.blocked = "Contato inativo ou não identificado";
  else if (!stage) row.blocked = "Sem envio hoje";
  else if (!contact.phone) row.blocked = "Telefone não informado";
  const template = templates.find(t => t.name === stage && t.status === "APPROVED" && t.instance_id === senderInstanceId && t.language === "pt_BR");
  if (row.blocked) return row;
  if (!template) return { ...row, blocked: "Template aprovado não encontrado no número escolhido" };
  const values: Record<CollectionParameterKind, string> = { name: contact?.name ?? payment.contact_name ?? "", due_date: payment.due_date?.split("-").reverse().join("/") ?? "", invoice_url: payment.invoice_url ?? "" };
  const texts: string[] = [];
  for (const component of template.components) {
    const kind = component.type.toLowerCase();
    // Only the textual mappings specified by the supplied skill are approved.
    if (!["body", "header", "footer"].includes(kind) || (component.format && component.format !== "TEXT")) return { ...row, blocked: "Template exige configuração de mídia ou botões" };
    const text = component.text ?? "";
    let missing = false;
    const rendered = text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, index: string) => {
      const parameterKind = collectionTemplateParameterKind(template.name, text, index);
      const value = parameterKind ? values[parameterKind] : "";
      if (!value || (kind !== "body")) { missing = true; return ""; }
      row.parameters[`body_${index}`] = value; return value;
    });
    if (missing || rendered.includes("{{")) return { ...row, blocked: "Variáveis do template precisam de revisão" };
    texts.push(rendered);
  }
  if (!texts.some(Boolean)) return { ...row, blocked: "Template sem texto para aprovação" };
  return { ...row, text: texts.join("\n\n"), language: template.language };
}
