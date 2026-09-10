"use client";

import { lazy, Suspense, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger, ComboboxValue } from "@/components/ui/combobox";
import { localDate, summarizeActivities, type CustomerActivity } from "@/lib/customer-activity";
import { isPaidStatus, money, monthlyValue, type Customer, type CommercialActor, type ImplementationPayment, type Subscription, type Payment } from "@/lib/metrics";

type ComboboxOption = { value: string; label: string };

const RevenueCharts = lazy(() => import("./revenue-section").then(module => ({ default: module.RevenueCharts })));

export function OverviewSection({ actors, customers, subscriptions, payments, implementationPayments, events }: { actors: CommercialActor[]; customers: Customer[]; subscriptions: Subscription[]; payments: Payment[]; implementationPayments: ImplementationPayment[]; events: CustomerActivity[] }) {
  const [start, setStart] = useState(() => localDate().slice(0, 7) + "-01");
  const [end, setEnd] = useState(localDate);
  const [customerId, setCustomerId] = useState("all");
  const [actorId, setActorId] = useState("all");
  const [status, setStatus] = useState("all");
  const invalidPeriod = Boolean(start && end && start > end);
  const inPeriod = (date: string | null) => !invalidPeriod && Boolean(date && (!start || date.slice(0, 10) >= start) && (!end || date.slice(0, 10) <= end));
  const scoped = customers.filter(customer => (customerId === "all" || customer.id === customerId) && (actorId === "all" || customer.acquisition_actor_id === actorId) && (status === "all" || customer.status === status));
  const ids = new Set(scoped.map(customer => customer.id));
  const filteredEvents = events.filter(event => ids.has(event.customerId) && inPeriod(event.occurredOn));
  const summary = summarizeActivities(filteredEvents);
  const active = subscriptions.filter(subscription => ids.has(subscription.customer_id) && subscription.status === "ACTIVE");
  const paid = payments.filter(payment => ids.has(payment.customer_id ?? "") && isPaidStatus(payment.status) && inPeriod(payment.payment_date));
  const paidImplementations = implementationPayments.filter(payment => ids.has(payment.customer_id ?? "") && isPaidStatus(payment.status) && inPeriod(payment.payment_date));
  const activeCustomers = new Set(active.map(subscription => subscription.customer_id)).size;
  const activeMrr = money.format(active.reduce((sum, subscription) => sum + monthlyValue(subscription.value, subscription.billing_period), 0));
  const heroMetrics = [
    ["Clientes com assinatura ativa", String(activeCustomers)],
    ["Upsells", String(summary.upsells)],
    ["Cancelamentos registrados", String(summary.cancellations)],
    ["Valor adicional contratado", money.format(summary.upsellValue)],
  ];
  const groups = [
    { title: "Assinaturas", items: [
      ["Assinaturas mensais ativas", String(active.filter(s => s.billing_period === "MONTHLY").length)],
      ["Assinaturas anuais ativas", String(active.filter(s => s.billing_period === "ANNUAL").length)],
      ["MRR das assinaturas ativas", activeMrr],
    ] },
    { title: "Expansão e renovação", items: [
      ["Renovações", String(summary.renewals)],
      ["Valor das renovações", money.format(summary.renewalValue)],
    ] },
    { title: "Contração e reativação", items: [
      ["Downsells", String(summary.downsells)],
      ["Redução por downsells", money.format(summary.downsellValue)],
      ["Reativações", String(summary.reactivations)],
      ["Valor das reativações", money.format(summary.reactivationValue)],
    ] },
    { title: "Mudanças de plano", items: [
      ["Upgrades de plano", String(summary.upgrades)],
      ["Downgrades de plano", String(summary.downgrades)],
      ["Mudanças de periodicidade", String(summary.periodChanges)],
      ["Anual → mensal", String(summary.annualToMonthly)],
      ["Mensal → anual", String(summary.monthlyToAnnual)],
      ["Impacto das mudanças no MRR", money.format(summary.totalMrrDelta)],
    ] },
    { title: "Aquisição e cobrança", items: [
      ["Novos clientes", String(scoped.filter(customer => inPeriod(customer.signed_at)).length)],
      ["Recebido", money.format(paid.reduce((sum, payment) => sum + Number(payment.value), 0))],
      ["Implantações pagas", String(paidImplementations.length)],
      ["Valor de implantações recebido", money.format(paidImplementations.reduce((sum, payment) => sum + Number(payment.value), 0))],
    ] },
  ];
  const selectClass = "mt-1 h-10 w-full rounded-md border border-slate-200 dark:border-border bg-white dark:bg-card px-3 text-sm";
  const customerItems = useMemo<ComboboxOption[]>(() => [{ value: "all", label: "Todos os clientes" }, ...customers.map(customer => ({ value: customer.id, label: customer.office_name }))], [customers]);
  const selectedCustomer = customerItems.find(item => item.value === customerId) ?? customerItems[0];
  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500 dark:text-muted-foreground">Filtros</h2>
        <p className="text-sm text-muted-foreground">{scoped.length} cliente(s) selecionado(s)</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="text-sm">De<Input type="date" value={start} onChange={event => setStart(event.target.value)} /></label>
        <label className="text-sm">Até<Input type="date" value={end} onChange={event => setEnd(event.target.value)} /></label>
        <label className="text-sm">Cliente<Combobox items={customerItems} value={selectedCustomer} onValueChange={item => setCustomerId(item?.value ?? "all")} limit={50}><ComboboxTrigger className={selectClass + " flex items-center justify-between gap-2 text-left"}><ComboboxValue placeholder="Todos os clientes" /></ComboboxTrigger><ComboboxContent><div className="p-1"><ComboboxInput placeholder="Buscar cliente…" showTrigger={false} className="w-full" /></div><ComboboxEmpty>Nenhum cliente encontrado.</ComboboxEmpty><ComboboxList>{(item: ComboboxOption) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox></label>
        <label className="text-sm">Parceiro de origem<select className={selectClass} value={actorId} onChange={event => setActorId(event.target.value)}><option value="all">Todos os parceiros</option>{actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
        <label className="text-sm">Status atual<select className={selectClass} value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todos os status</option><option value="ACTIVE">Ativo</option><option value="FROZEN">Congelado</option><option value="CANCELLED">Cancelado</option></select></label>
      </div>
      {invalidPeriod && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">A data inicial deve ser anterior ou igual à data final.</p>}
      <details className="mt-3 text-sm text-muted-foreground"><summary className="w-fit">Como os indicadores são calculados</summary><p className="mt-2 max-w-4xl leading-relaxed">Os registros são contados pela data do acontecimento ou vigência. Mudanças simultâneas de plano e periodicidade entram nas duas contagens, com impacto único no MRR. Upsells e downsells também entram no MRR das assinaturas afetadas a partir da data registrada. Valores anuais são divididos por 12; não há cobrança proporcional.</p></details>
    </section>
    {!invalidPeriod && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{heroMetrics.map(([label, value]) => <article key={label} className="metric-card rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-5"><p className="text-sm text-slate-500 dark:text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-[#24477e] dark:text-primary">{value}</p></article>)}</section>}
    {!invalidPeriod && <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-5 sm:p-6">
      <h2 className="font-semibold">Detalhamento do período</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">Posição atual e movimentações dos clientes selecionados.</p>
      <div className="mt-5 space-y-5">
        {groups.map(group => <div key={group.title}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-muted-foreground">{group.title}</h3>
          <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            {group.items.map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 dark:border-border/60">
              <span className="text-sm text-slate-500 dark:text-muted-foreground">{label}</span>
              <span className="text-sm font-semibold tabular-nums">{value}</span>
            </div>)}
          </div>
        </div>)}
      </div>
    </section>}
    {!invalidPeriod && <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando gráficos…</p>}><RevenueCharts subscriptions={active} payments={paid}/></Suspense>}
  </div>;
}
