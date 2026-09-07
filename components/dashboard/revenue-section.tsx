"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { isPaidStatus, monthlyValue, type Payment, type Subscription } from "@/lib/metrics";

const chartConfig: ChartConfig = { mrr: { label: "MRR", color: "#3b82f6" }, realizado: { label: "Recebido", color: "#bcd3f7" } };

export function RevenueCharts({ subscriptions, payments }: { subscriptions: Subscription[]; payments: Payment[] }) {
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "ACTIVE");

  const byPlan = new Map<string, { label: string; mrr: number }>();
  for (const subscription of activeSubscriptions) {
    const key = subscription.display_plan_name ?? "Sem plano vinculado";
    const label = subscription.display_plan_name && subscription.display_plan_name !== "—" ? subscription.display_plan_name : "Sem plano vinculado";
    const entry = byPlan.get(key) ?? { label, mrr: 0 };
    entry.mrr += monthlyValue(subscription.value, subscription.billing_period);
    byPlan.set(key, entry);
  }
  const chartData = Array.from(byPlan.values()).map(({ label, mrr }) => ({ plan: label, mrr: Number(mrr.toFixed(2)) }));


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
      <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <h2 className="font-semibold">MRR por plano</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">Assinaturas ativas dos clientes selecionados; valores anuais normalizados para equivalente mensal</p>
        {chartData.length === 0 ? <p className="mt-6 text-sm text-slate-500 dark:text-muted-foreground">Nenhuma assinatura ativa para compor o gráfico.</p> : (
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
      <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <h2 className="font-semibold">Receita realizada por mês no período selecionado</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">Soma de pagamentos com status recebido/confirmado no Asaas — receita de fato, não valor de links gerados</p>
        {revenueByMonth.length === 0 ? <p className="mt-6 text-sm text-slate-500 dark:text-muted-foreground">Nenhum pagamento registrado ainda.</p> : (
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
