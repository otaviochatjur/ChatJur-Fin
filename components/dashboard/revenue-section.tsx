"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { money, monthlyValue, type PaymentLink, type Plan } from "@/lib/metrics";

const chartConfig: ChartConfig = { mrr: { label: "MRR", color: "#167354" } };

export function RevenueSection({ links, plans, totalMrr }: { links: PaymentLink[]; plans: Plan[]; totalMrr: number }) {
  const activeLinks = links.filter((link) => link.status === "ACTIVE");
  const byPlan = new Map<string, number>();
  for (const link of activeLinks) {
    const key = link.plan_id ?? "sem-plano";
    byPlan.set(key, (byPlan.get(key) ?? 0) + monthlyValue(link.value, link.billing_period));
  }
  const chartData = Array.from(byPlan.entries()).map(([planId, mrr]) => ({
    plan: plans.find((plan) => plan.id === planId)?.name ?? "Sem plano",
    mrr: Number(mrr.toFixed(2)),
  }));

  const monthly = activeLinks.filter((link) => link.billing_period === "MONTHLY");
  const annual = activeLinks.filter((link) => link.billing_period === "ANNUAL");

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-[#123a2e] p-5 text-white"><p className="text-sm text-emerald-100">MRR total</p><p className="mt-2 text-2xl font-semibold">{money.format(totalMrr)}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Contratos mensais ativos</p><p className="mt-2 text-2xl font-semibold">{monthly.length}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Contratos anuais ativos</p><p className="mt-2 text-2xl font-semibold">{annual.length}</p></article>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <h2 className="font-semibold">MRR por plano</h2>
        <p className="mt-1 text-sm text-slate-500">Valores anuais normalizados para equivalente mensal</p>
        {chartData.length === 0 ? <p className="mt-6 text-sm text-slate-500">Sem links ativos ainda para compor o gráfico.</p> : (
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
    </div>
  );
}
