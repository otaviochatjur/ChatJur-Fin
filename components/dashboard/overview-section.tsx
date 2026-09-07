"use client";

import { lazy, Suspense, useState } from "react";
import { Input } from "@/components/ui/input";
import { localDate, summarizeActivities, type CustomerActivity } from "@/lib/customer-activity";
import { isPaidStatus, money, monthlyValue, type Customer, type CommercialActor, type ImplementationPayment, type Subscription, type Payment } from "@/lib/metrics";

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
  const cards = [
    ["Assinaturas mensais ativas", String(active.filter(s=>s.billing_period==="MONTHLY").length)], ["Assinaturas anuais ativas", String(active.filter(s=>s.billing_period==="ANNUAL").length)],
    ["Upsells", String(summary.upsells)], ["Valor adicional contratado", money.format(summary.upsellValue)],
    ["Renovações", String(summary.renewals)], ["Valor das renovações", money.format(summary.renewalValue)],
    ["Downsells", String(summary.downsells)], ["Redução por downsells", money.format(summary.downsellValue)],
    ["Upgrades de plano", String(summary.upgrades)], ["Downgrades de plano", String(summary.downgrades)],
    ["Mudanças de periodicidade", String(summary.periodChanges)], ["Anual → mensal", String(summary.annualToMonthly)], ["Mensal → anual", String(summary.monthlyToAnnual)],
    ["Impacto das mudanças no MRR", money.format(summary.totalMrrDelta)], ["Cancelamentos registrados", String(summary.cancellations)],
    ["Reativações", String(summary.reactivations)], ["Valor das reativações", money.format(summary.reactivationValue)],
    ["Novos clientes", String(scoped.filter(customer => inPeriod(customer.signed_at)).length)],
    ["Recebido", money.format(paid.reduce((sum, payment) => sum + Number(payment.value), 0))],
    ["Implantações pagas", String(paidImplementations.length)],
    ["Valor de implantações recebido", money.format(paidImplementations.reduce((sum, payment) => sum + Number(payment.value), 0))],
  ];
  const selectClass = "mt-1 h-10 w-full rounded-md border border-slate-200 dark:border-border bg-white dark:bg-card px-3 text-sm";
  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-5">
      <h2 className="font-semibold">Filtrar indicadores</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="text-sm">De<Input type="date" value={start} onChange={event => setStart(event.target.value)} /></label>
        <label className="text-sm">Até<Input type="date" value={end} onChange={event => setEnd(event.target.value)} /></label>
        <label className="text-sm">Cliente<select className={selectClass} value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="all">Todos os clientes</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.office_name}</option>)}</select></label>
        <label className="text-sm">Parceiro de origem<select className={selectClass} value={actorId} onChange={event => setActorId(event.target.value)}><option value="all">Todos os parceiros</option>{actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
        <label className="text-sm">Status atual<select className={selectClass} value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todos os status</option><option value="ACTIVE">Ativo</option><option value="FROZEN">Congelado</option><option value="CANCELLED">Cancelado</option></select></label>
      </div>
      {invalidPeriod && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">A data inicial deve ser anterior ou igual à data final.</p>}
      <p className="mt-3 text-sm text-muted-foreground">{scoped.length} cliente(s) selecionado(s)</p><details className="mt-2 text-sm text-muted-foreground"><summary className="w-fit">Como os indicadores são calculados</summary><p className="mt-2 max-w-4xl leading-relaxed">Os registros são contados pela data do acontecimento ou vigência. Mudanças simultâneas de plano e periodicidade entram nas duas contagens, com impacto único no MRR. Upsells e downsells também entram no MRR das assinaturas afetadas a partir da data registrada. Valores anuais são divididos por 12; não há cobrança proporcional.</p></details>
    </section>
    {!invalidPeriod && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <article key={label} className="metric-card rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-5"><p className="text-sm text-slate-500 dark:text-muted-foreground">{label}</p><p className="mt-3 text-2xl font-semibold text-[#24477e] dark:text-primary">{value}</p></article>)}</section>}
    <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-5">
      <h2 className="font-semibold">Carteira atual</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">Posição atual dos clientes selecionados, independente do período acima.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500 dark:text-muted-foreground">Clientes com assinatura ativa</p><p className="text-2xl font-semibold">{new Set(active.map(subscription => subscription.customer_id)).size}</p></div><div><p className="text-sm text-slate-500 dark:text-muted-foreground">MRR das assinaturas ativas</p><p className="text-2xl font-semibold">{money.format(active.reduce((sum, subscription) => sum + monthlyValue(subscription.value, subscription.billing_period), 0))}</p></div></div>
    </section>
    {!invalidPeriod && <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando gráficos…</p>}><RevenueCharts subscriptions={active} payments={paid}/></Suspense>}
  </div>;
}
