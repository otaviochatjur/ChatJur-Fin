"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { planMrrDelta, activityLabels, itemCatalog, itemsTotal, localDate, type ActivityItem, type CustomerActivity } from "@/lib/customer-activity";
import { money, type Subscription } from "@/lib/metrics";

export function CustomerTimeline({ customerId, subscriptions, events, onChanged }: { subscriptions: Subscription[]; customerId: string; events: CustomerActivity[]; onChanged: () => void }) {
  const [subscriptionId, setSubscriptionId] = useState("");
  const [nextName, setNextName] = useState("");
  const [nextPeriod, setNextPeriod] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [nextValue, setNextValue] = useState("");
  const subscription = subscriptions.find(s => s.id === subscriptionId);
  const [type, setType] = useState<CustomerActivity["type"]>("FOLLOW_UP");
  const [date, setDate] = useState(localDate);
  const [amount, setAmount] = useState("");
  const [items, setItems] = useState<ActivityItem[]>([]);
  const changingPlan = ["UPGRADE", "DOWNGRADE", "PERIOD_CHANGE"].includes(type);
  const planChange = changingPlan && subscription ? { subscriptionId: subscription.id, before: { name: subscription.plan_name_raw ?? "Plano", period: subscription.billing_period, value: Number(subscription.value) }, after: { name: type === "PERIOD_CHANGE" ? subscription.plan_name_raw ?? "Plano" : nextName, period: nextPeriod, value: Number(nextValue) } } : undefined;
  const itemized = type === "UPSELL" || type === "DOWNSELL";
  const total = itemsTotal(items);
  const updateItem = (kind: ActivityItem["kind"], patch: Partial<ActivityItem>) => setItems(current => current.map(item => item.kind === kind ? { ...item, ...patch } : item));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const monetary = ["UPSELL", "RENEWAL", "DOWNSELL"].includes(type);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/customer-activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, type, occurredOn: date, ...(planChange ? { planChange } : {}), amount: planChange ? planChange.after.value : itemized ? total : monetary ? Number(amount) : 0, ...(itemized ? { items } : {}), notes }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar o registro.");
      setNotes(""); setAmount(""); setItems([]);
      toast.success("Registro salvo no histórico do cliente.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha de conexão. Tente novamente.");
    } finally { setSaving(false); }
  }
  return <section className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/30 p-4">
    <h3 className="font-semibold">Acompanhamento do cliente</h3>
    <form onSubmit={save} className="space-y-3">
      <label className="block text-sm">Tipo de registro<select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={type} onChange={event => setType(event.target.value as CustomerActivity["type"])}>{Object.entries(activityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block text-sm">{changingPlan ? "Data de vigência" : "Data do acontecimento"}<Input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
      {changingPlan && <fieldset className="space-y-3 rounded-lg border bg-white p-4">
        <legend className="px-1 font-semibold">Mudança de plano / periodicidade</legend>
        <label className="block text-sm">Assinatura<select required className="mt-1 h-10 w-full rounded-md border px-3" value={subscriptionId} onChange={event => { setSubscriptionId(event.target.value); const chosen = subscriptions.find(s => s.id === event.target.value); if (chosen) { setNextPeriod(chosen.billing_period); setNextValue(String(chosen.value)); setNextName(chosen.plan_name_raw ?? "Plano"); } }}><option value="">Selecione a assinatura</option>{subscriptions.filter(s => s.status === "ACTIVE").map(s => <option key={s.id} value={s.id}>{s.plan_name_raw ?? "Plano"} · {s.billing_period === "ANNUAL" ? "Anual" : "Mensal"} · {money.format(s.value)}</option>)}</select></label>
        {subscription && <p className="text-sm text-slate-500">Antes: {subscription.plan_name_raw ?? "Plano"} · {subscription.billing_period === "ANNUAL" ? "Anual" : "Mensal"} · {money.format(subscription.value)}</p>}
        {type !== "PERIOD_CHANGE" && <label className="block text-sm">Novo plano<Input required maxLength={200} value={nextName} onChange={event => setNextName(event.target.value)} /></label>}
        <label className="block text-sm">Nova periodicidade<select className="mt-1 h-10 w-full rounded-md border px-3" value={nextPeriod} onChange={event => setNextPeriod(event.target.value as "ANNUAL" | "MONTHLY")}><option value="MONTHLY">Mensal</option><option value="ANNUAL">Anual</option></select></label>
        <label className="block text-sm">Novo valor integral {nextPeriod === "ANNUAL" ? "anual" : "mensal"} (R$)<Input required type="number" min="0.01" max="999999999" step="0.01" value={nextValue} onChange={event => setNextValue(event.target.value)} /></label>
        <p className="text-sm">Impacto no MRR: {money.format(planMrrDelta(planChange))}</p>
        <p className="text-sm text-slate-500">O novo valor passa a valer na data de vigência nos relatórios internos. Sem cobrança proporcional ou créditos. Este registro não altera cobranças no Asaas.</p>
      </fieldset>}
      {monetary && !itemized && <label className="block text-sm">Valor da renovação (R$)<Input type="number" min="0.01" max="999999999" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></label>}
      {itemized && <fieldset className="space-y-3 rounded-lg border bg-white p-4">
        <legend className="px-1 text-sm font-semibold">{type === "UPSELL" ? "Itens adicionados" : "Itens removidos"}</legend>
        <p className="text-sm text-slate-500">Selecione os itens e informe o valor total de cada um para a quantidade escolhida.</p>
        {(Object.entries(itemCatalog) as [ActivityItem["kind"], { label: string; quantities: number[] }][]).map(([kind, config]) => {
          const item = items.find(entry => entry.kind === kind);
          return <div key={kind} className="rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={Boolean(item)} onChange={event => setItems(current => event.target.checked ? [...current, { kind, quantity: config.quantities[0] ?? null, amount: 0 }] : current.filter(entry => entry.kind !== kind))} />{config.label}</label>
            {item && <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {config.quantities.length > 0 && <label className="text-sm">Quantidade<select className="mt-1 h-9 w-full rounded-md border bg-white px-3" value={item.quantity ?? ""} onChange={event => updateItem(kind, { quantity: Number(event.target.value) })}>{config.quantities.map(quantity => <option key={quantity} value={quantity}>{quantity}</option>)}</select></label>}
              <label className="text-sm">Valor total do item (R$)<Input type="number" min="0" max="999999999" step="0.01" required value={item.amount} placeholder="0,00" onChange={event => updateItem(kind, { amount: Number(event.target.value) })} /></label>
            </div>}
          </div>;
        })}
        <p aria-live="polite" className="text-lg font-semibold text-blue-800">{type === "UPSELL" ? "Acréscimo total" : "Redução total"}: {money.format(total)}</p>
      </fieldset>}
      <label className="block text-sm">Observações{type === "CANCELLATION" ? "" : " (opcional)"}<Textarea required={type === "CANCELLATION"} maxLength={5000} value={notes} onChange={event => setNotes(event.target.value)} placeholder={type === "CANCELLATION" ? "Descreva o motivo do cancelamento." : "Descreva a mudança, o plano e o período contratado ou os próximos passos."} /></label>
      <p className="text-xs text-slate-500">Este registro alimenta as métricas comerciais. Atualize o cadastro abaixo quando houver mudança de status; assinaturas e recebimentos continuam vinculados aos pagamentos.</p>
      <Button disabled={saving || (changingPlan && !subscription) || (itemized && (!items.length || total <= 0))} type="submit">{saving ? "Salvando…" : "Registrar acontecimento"}</Button>
    </form>
    <div className="space-y-3 border-t pt-4">
      <h4 className="text-sm font-semibold">Histórico ({events.length})</h4>
      {events.length === 0 && <p className="text-sm text-slate-500">Nenhum acompanhamento registrado.</p>}
      <div className="max-h-96 space-y-3 overflow-y-auto">{[...events].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt)).map(event => <article key={event.id} className="rounded-lg border bg-white p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><strong>{activityLabels[event.type]}</strong><span>{event.occurredOn.split("-").reverse().join("/")}</span></div>
        {event.amount > 0 && <p className="mt-1 font-medium text-blue-700">{money.format(event.amount)}</p>}
        {event.planChange && <div className="mt-2 text-sm"><p>{event.planChange.before.name} ({event.planChange.before.period === "ANNUAL" ? "Anual" : "Mensal"}, {money.format(event.planChange.before.value)}) → {event.planChange.after.name} ({event.planChange.after.period === "ANNUAL" ? "Anual" : "Mensal"}, {money.format(event.planChange.after.value)})</p><p>Impacto no MRR: {money.format(planMrrDelta(event.planChange))} · Vigência: {event.occurredOn.split("-").reverse().join("/")}</p></div>}
        {event.items && <ul className="mt-2 space-y-1">{event.items.map(item => <li key={item.kind} className="flex justify-between gap-3"><span>{itemCatalog[item.kind].label}{item.quantity !== null ? ` · ${item.quantity}` : ""}</span><span>{money.format(item.amount)}</span></li>)}</ul>}
        {event.notes && <p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{event.notes}</p>}
      </article>)}</div>
    </div>
  </section>;
}
