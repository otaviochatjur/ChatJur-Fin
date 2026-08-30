import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { money, type PaymentLink, type Plan } from "@/lib/metrics";

export function PlansUsageSection({ plans, links }: { plans: Plan[]; links: PaymentLink[] }) {
  const activeCountByPlan = new Map<string, number>();
  for (const link of links) {
    if (link.status !== "ACTIVE" || !link.plan_id) continue;
    activeCountByPlan.set(link.plan_id, (activeCountByPlan.get(link.plan_id) ?? 0) + 1);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-semibold">Catálogo de planos</h2>
        <p className="mt-1 text-sm text-slate-500">Tabela padrão definida em Supabase · preços por parceiro podem ter versões próprias</p>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Plano</TableHead><TableHead>Periodicidade</TableHead><TableHead className="text-right">Preço padrão</TableHead><TableHead>Parcelamento</TableHead><TableHead className="text-right">Links ativos</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          {plans.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-slate-500">Nenhum plano cadastrado — rode supabase/seed.sql.</TableCell></TableRow>}
          {plans.map((plan) => (
            <TableRow key={plan.id}>
              <TableCell className="font-medium">{plan.name}</TableCell>
              <TableCell><Badge variant="outline">{plan.billing_period === "ANNUAL" ? "Anual" : "Mensal"}</Badge></TableCell>
              <TableCell className="text-right">{money.format(plan.standard_value)}</TableCell>
              <TableCell>{plan.annual_installment_limit ? `até ${plan.annual_installment_limit}x` : "—"}</TableCell>
              <TableCell className="text-right">{activeCountByPlan.get(plan.id) ?? 0}</TableCell>
              <TableCell><StatusBadge status={plan.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
