"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { isPaidStatus, money, monthlyValue, type Payment, type Plan, type Subscription } from "@/lib/metrics";

const chartConfig: ChartConfig = { mrr: { label: "MRR", color: "#3b82f6" }, realizado: { label: "Recebido", color: "#bcd3f7" } };

type Totals = { mrr: number; realizedThisMonth: number; realizedTotal: number };

export function RevenueSection({ subscriptions, payments, plans, totals }: { subscriptions: Subscription[]; payments: Payment[]; plans: Plan[]; totals: Totals }) {
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "ACTIVE");

  const byPlan = new Map<string, { label: string; mrr: number }>();
  for (const subscription of activeSubscriptions) {
    const key = subscription.plan_id ?? subscription.custom_plan_id ?? subscription.plan_name_raw ?? "outro";
    const label = plans.find((plan) => plan.id === subscription.plan_id)?.name ?? subscription.plan_name_raw ?? "Outro";
    const entry = byPlan.get(key) ?? { label, mrr: 0 };
    entry.mrr += monthlyValue(subscription.value, subscription.billing_period);
    byPlan.set(key, entry);
  }
  const chartData = Array.from(byPlan.values()).map(({ label, mrr }) => ({ plan: label, mrr: Number(mrr.toFixed(2)) }));

  const monthly = activeSubscriptions.filter((subscription) => subscription.billing_period === "MONTHLY");
  const annual = activeSubscriptions.filter((subscription) => subscription.billing_period === "ANNUAL");

  const paidPayments = payments.filter((payment) => isPaidStatus(payment.status));
  const byMonth = new Map<string, number>();
  for (const payment of paidPayments) {
    const key = (payment.payment_date ?? payment.confirmed_date ?? "").slice(0, 7);
    if (!key) continue;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(payment.value));
  }
  const revenueByMonth = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, value]) => ({ month, realizado: Number(value.toFixed(2)) }));

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-[#3a5d9d] p-5 text-white"><p className="text-sm text-blue-100">MRR (assinaturas ativas)</p><p className="mt-2 text-2xl font-semibold">{money.format(totals.mrr)}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Recebido este mês</p><p className="mt-2 text-2xl font-semibold">{money.format(totals.realizedThisMonth)}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Assinaturas mensais ativas</p><p className="mt-2 text-2xl font-semibold">{monthly.length}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Assinaturas anuais ativas</p><p className="mt-2 text-2xl font-semibold">{annual.length}</p></article>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <h2 className="font-semibold">MRR por plano</h2>
        <p className="mt-1 text-sm text-slate-500">Somente assinaturas com pelo menos um pagamento confirmado no Asaas; valores anuais normalizados para equivalente mensal</p>
        {chartData.length === 0 ? <p className="mt-6 text-sm text-slate-500">Nenhum pagamento confirmado ainda para compor o gráfico.</p> : (
          <ChartContainer config={chartConfig} className="mt-4 max-h-72 w-full">
            <BarChart data={chartData}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="plan" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="mrr" fill="var(--color-mrr)" radius={6} />
            </BarChart>
          </ChartContainer>
        )}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <h2 className="font-semibold">Receita realizada por mês</h2>
        <p className="mt-1 text-sm text-slate-500">Soma de pagamentos com status recebido/confirmado no Asaas — receita de fato, não valor de links gerados</p>
        {revenueByMonth.length === 0 ? <p className="mt-6 text-sm text-slate-500">Nenhum pagamento registrado ainda.</p> : (
          <ChartContainer config={chartConfig} className="mt-4 max-h-72 w-full">
            <BarChart data={revenueByMonth}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="realizado" fill="var(--color-realizado)" radius={6} />
            </BarChart>
          </ChartContainer>
        )}
      </section>
    </div>
  );
}
