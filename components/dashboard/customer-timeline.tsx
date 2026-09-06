"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { planMrrDelta, itemizedMrrDelta, activityLabels, itemCatalog, itemsTotal, localDate, type ActivityItem, type CustomerActivity } from "@/lib/customer-activity";
import { money, type Subscription } from "@/lib/metrics";

export function CustomerTimeline({ customerId, subscriptions, events, onChanged }: { subscriptions: Subscription[]; customerId: string; events: CustomerActivity[]; onChanged: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
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
  const itemized = type === "UPSELL" || type === "DOWNSELL";
  const needsSubscription = changingPlan || itemized;
  const planChange = changingPlan && subscription ? { subscriptionId: subscription.id, before: { name: subscription.plan_name_raw ?? "Plano", period: subscription.billing_period, value: Number(subscription.value) }, after: { name: type === "PERIOD_CHANGE" ? subscription.plan_name_raw ?? "Plano" : nextName, period: nextPeriod, value: Number(nextValue) } } : undefined;
  const total = itemsTotal(items);
  const itemizedImpact = itemized ? itemizedMrrDelta({ type, amount: total }) : 0;
  const updateItem = (kind: ActivityItem["kind"], patch: Partial<ActivityItem>) => setItems(current => current.map(item => item.kind === kind ? { ...item, ...patch } : item));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const monetary = ["UPSELL", "RENEWAL", "DOWNSELL", "REACTIVATION"].includes(type);

  function resetForm() {
    setEditingId(null); setType("FOLLOW_UP"); setDate(localDate()); setAmount(""); setItems([]); setSubscriptionId(""); setNextName(""); setNextPeriod("MONTHLY"); setNextValue(""); setNotes("");
  }

  function startEdit(target: CustomerActivity) {
    setEditingId(target.id);
    setType(target.type);
    setDate(target.occurredOn);
    setNotes(target.notes ?? "");
    setItems(target.items ?? []);
    if (target.planChange) {
      setSubscriptionId(target.planChange.subscriptionId);
      setNextName(target.planChange.after.name);
      setNextPeriod(target.planChange.after.period);
      setNextValue(String(target.planChange.after.value));
    } else if (target.subscriptionId) {
      setSubscriptionId(target.subscriptionId);
    } else {
      setSubscriptionId(""); setNextName(""); setNextPeriod("MONTHLY"); setNextValue("");
    }
    setAmount(target.type === "RENEWAL" || target.type === "REACTIVATION" ? String(target.amount) : "");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        ...(editingId ? { id: editingId } : {}),
        customerId, type, occurredOn: date,
        ...(planChange ? { planChange } : {}),
        ...(itemized && subscription ? { subscriptionId: subscription.id } : {}),
        amount: planChange ? planChange.after.value : itemized ? total : monetary ? Number(amount) : 0,
        ...(itemized ? { items } : {}),
        notes,
      };
      const response = await fetch("/api/customer-activities", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar o registro.");
      resetForm();
      toast.success(editingId ? "Registro atualizado." : "Registro salvo no histórico do cliente.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha de conexão. Tente novamente.");
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Excluir este registro do histórico? Essa ação não pode ser desfeita e pode alterar o MRR calculado.")) return;
    setDeletingId(id);
    try {
      const response = await fetch(`/api/customer-activities?id=${id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível excluir o registro.");
      if (editingId === id) resetForm();
      toast.success("Registro excluído.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha de conexão. Tente novamente.");
    } finally { setDeletingId(null); }
  }

  return <section className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/30 p-4">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Acompanhamento do cliente</h3>{editingId && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">Editando registro<button type="button" onClick={resetForm} className="ml-1 rounded-full hover:bg-amber-200"><X className="size-3" /></button></span>}</div>
    <form onSubmit={save} className="space-y-3">
      <label className="block text-sm">Tipo de registro<select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={type} onChange={event => { setType(event.target.value as CustomerActivity["type"]); setSubscriptionId(""); }}>{Object.entries(activityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block text-sm">{changingPlan ? "Data de vigência" : "Data do acontecimento"}<Input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
      {needsSubscription && <label className="block text-sm">Assinatura afetada<select required className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={subscriptionId} onChange={event => { setSubscriptionId(event.target.value); const chosen = subscriptions.find(s => s.id === event.target.value); if (chosen && changingPlan) { setNextPeriod(chosen.billing_period); setNextValue(String(chosen.value)); setNextName(chosen.plan_name_raw ?? "Plano"); } }}><option value="">Selecione a assinatura</option>{subscriptions.filter(s => s.status === "ACTIVE" || s.id === subscriptionId).map(s => <option key={s.id} value={s.id}>{s.plan_name_raw ?? "Plano"} · {s.billing_period === "ANNUAL" ? "Anual" : "Mensal"} · {money.format(s.value)}</option>)}</select></label>}
      {changingPlan && <fieldset className="space-y-3 rounded-lg border bg-white p-4">
        <legend className="px-1 font-semibold">Mudança de plano / periodicidade</legend>
        {subscription && <p className="text-sm text-slate-500">Antes: {subscription.plan_name_raw ?? "Plano"} · {subscription.billing_period === "ANNUAL" ? "Anual" : "Mensal"} · {money.format(subscription.value)}</p>}
        {type !== "PERIOD_CHANGE" && <label className="block text-sm">Novo plano<Input required maxLength={200} value={nextName} onChange={event => setNextName(event.target.value)} /></label>}
        <label className="block text-sm">Nova periodicidade<select className="mt-1 h-10 w-full rounded-md border px-3" value={nextPeriod} onChange={event => setNextPeriod(event.target.value as "ANNUAL" | "MONTHLY")}><option value="MONTHLY">Mensal</option><option value="ANNUAL">Anual</option></select></label>
        <label className="block text-sm">Novo valor integral {nextPeriod === "ANNUAL" ? "anual" : "mensal"} (R$)<Input required type="number" min="0.01" max="999999999" step="0.01" value={nextValue} onChange={event => setNextValue(event.target.value)} /></label>
        <p className="text-sm">Impacto no MRR: {money.format(planMrrDelta(planChange))}</p>
        <p className="text-sm text-slate-500">O novo valor passa a valer na data de vigência nos relatórios internos. Sem cobrança proporcional ou créditos. Este registro não altera cobranças no Asaas.</p>
      </fieldset>}
      {monetary && !itemized && <label className="block text-sm">{type === "REACTIVATION" ? "Valor do novo contrato (R$)" : "Valor da renovação (R$)"}<Input type="number" min="0.01" max="999999999" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></label>}
      {type === "REACTIVATION" && <p className="text-sm text-slate-500">Ao salvar, o cadastro do cliente volta automaticamente para o status Ativo. Lembre-se de garantir que exista uma assinatura ativa: pague por um novo link (a sincronização cria a assinatura sozinha) ou cadastre o plano manualmente em Assinaturas.</p>}
      {itemized && <fieldset className="space-y-3 rounded-lg border bg-white p-4">
        <legend className="px-1 text-sm font-semibold">{type === "UPSELL" ? "Itens adicionados" : "Itens removidos"}</legend>
        <p className="text-sm text-slate-500">Selecione os itens e informe o valor mensal total de cada um para a quantidade escolhida.</p>
        {(Object.entries(itemCatalog) as [ActivityItem["kind"], { label: string; quantities: number[] }][]).map(([kind, config]) => {
          const item = items.find(entry => entry.kind === kind);
          return <div key={kind} className="rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={Boolean(item)} onChange={event => setItems(current => event.target.checked ? [...current, { kind, quantity: config.quantities[0] ?? null, amount: 0 }] : current.filter(entry => entry.kind !== kind))} />{config.label}</label>
            {item && <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {config.quantities.length > 0 && <label className="text-sm">Quantidade<select className="mt-1 h-9 w-full rounded-md border bg-white px-3" value={item.quantity ?? ""} onChange={event => updateItem(kind, { quantity: Number(event.target.value) })}>{config.quantities.map(quantity => <option key={quantity} value={quantity}>{quantity}</option>)}</select></label>}
              <label className="text-sm">Valor mensal total do item (R$)<Input type="number" min="0" max="999999999" step="0.01" required value={item.amount} placeholder="0,00" onChange={event => updateItem(kind, { amount: Number(event.target.value) })} /></label>
            </div>}
          </div>;
        })}
        <p aria-live="polite" className="text-lg font-semibold text-blue-800">{type === "UPSELL" ? "Acréscimo total" : "Redução total"}: {money.format(total)}</p>
        <p className="text-sm">Impacto no MRR: {money.format(itemizedImpact)}</p>
        <p className="text-sm text-slate-500">
          {subscription?.billing_period === "ANNUAL"
            ? "Assinatura anual: este valor mensal é somado ao ciclo de 12 meses do contrato (equivalente a " + money.format(total * 12) + " no valor integral anual)."
            : "Somado ao valor da assinatura selecionada a partir desta data, refletindo no MRR em Visão Geral, Receita e Repasses. Sem cobrança proporcional; este registro não altera cobranças no Asaas."}
        </p>
      </fieldset>}
      {type === "CANCELLATION" && <p className="text-sm text-slate-500">Ao salvar, o cadastro do cliente volta automaticamente para o status Cancelado.</p>}
      <label className="block text-sm">Observações{type === "CANCELLATION" ? "" : " (opcional)"}<Textarea required={type === "CANCELLATION"} maxLength={5000} value={notes} onChange={event => setNotes(event.target.value)} placeholder={type === "CANCELLATION" ? "Descreva o motivo do cancelamento." : "Descreva a mudança, o plano e o período contratado ou os próximos passos."} /></label>
      <p className="text-xs text-slate-500">Este registro alimenta as métricas comerciais. {["CANCELLATION", "REACTIVATION"].includes(type) ? "O status do cliente é atualizado automaticamente." : "Atualize o cadastro abaixo quando houver mudança de status."} Assinaturas e recebimentos continuam vinculados aos pagamentos.</p>
      <div className="flex gap-2">
        <Button disabled={saving || (needsSubscription && !subscription) || (itemized && (!items.length || total <= 0))} type="submit">{saving ? "Salvando…" : editingId ? "Salvar edição" : "Registrar acontecimento"}</Button>
        {editingId && <Button type="button" variant="outline" onClick={resetForm}>Cancelar edição</Button>}
      </div>
    </form>
    <div className="space-y-3 border-t pt-4">
      <h4 className="text-sm font-semibold">Histórico ({events.length})</h4>
      {events.length === 0 && <p className="text-sm text-slate-500">Nenhum acompanhamento registrado.</p>}
      <div className="max-h-96 space-y-3 overflow-y-auto">{[...events].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt)).map(event => <article key={event.id} className={"rounded-lg border bg-white p-3 text-sm" + (editingId === event.id ? " border-amber-300 ring-1 ring-amber-200" : "")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>{activityLabels[event.type]}</strong>
          <div className="flex items-center gap-2">
            <span>{event.occurredOn.split("-").reverse().join("/")}</span>
            <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => startEdit(event)} title="Editar registro"><Pencil className="size-3.5" /><span className="sr-only">Editar</span></Button>
            <Button type="button" variant="ghost" size="icon" className="size-7 text-red-600 hover:text-red-700" disabled={deletingId === event.id} onClick={() => remove(event.id)} title="Excluir registro"><Trash2 className="size-3.5" /><span className="sr-only">Excluir</span></Button>
          </div>
        </div>
        {event.amount > 0 && <p className="mt-1 font-medium text-blue-700">{money.format(event.amount)}</p>}
        {event.planChange && <div className="mt-2 text-sm"><p>{event.planChange.before.name} ({event.planChange.before.period === "ANNUAL" ? "Anual" : "Mensal"}, {money.format(event.planChange.before.value)}) → {event.planChange.after.name} ({event.planChange.after.period === "ANNUAL" ? "Anual" : "Mensal"}, {money.format(event.planChange.after.value)})</p><p>Impacto no MRR: {money.format(planMrrDelta(event.planChange))} · Vigência: {event.occurredOn.split("-").reverse().join("/")}</p></div>}
        {event.items && <ul className="mt-2 space-y-1">{event.items.map(item => <li key={item.kind} className="flex justify-between gap-3"><span>{itemCatalog[item.kind].label}{item.quantity !== null ? ` · ${item.quantity}` : ""}</span><span>{money.format(item.amount)}</span></li>)}</ul>}
        {event.subscriptionId && (event.type === "UPSELL" || event.type === "DOWNSELL") && <p className="mt-1 text-slate-500">Assinatura: {subscriptions.find(s => s.id === event.subscriptionId)?.plan_name_raw ?? "assinatura removida"} · Impacto no MRR: {money.format(itemizedMrrDelta(event))} · Vigência: {event.occurredOn.split("-").reverse().join("/")}</p>}
        {event.notes && <p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{event.notes}</p>}
      </article>)}</div>
    </div>
  </section>;
}
