import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { money, type CommercialActor, type PaymentLink } from "@/lib/metrics";

function addYears(iso: string, years: number) {
  const date = new Date(iso);
  date.setFullYear(date.getFullYear() + years);
  return date;
}

export function RenewalsSection({ links, actors }: { links: PaymentLink[]; actors: CommercialActor[] }) {
  const annualRenewals = links
    .filter((link) => link.status === "ACTIVE" && link.billing_period === "ANNUAL")
    .map((link) => ({ link, renewalDate: addYears(link.created_at, 1) }))
    .sort((a, b) => a.renewalDate.getTime() - b.renewalDate.getTime());

  const actorName = (id: string) => actors.find((actor) => actor.id === id)?.name ?? "—";
  // Wall-clock time only drives a display label (days remaining), not
  // memoized derived state, so a single narrowly-scoped exception is safe.
  // eslint-disable-next-line react-hooks/purity
  const today = Date.now();

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-semibold">Renovações de contratos anuais</h2>
        <p className="mt-1 text-sm text-slate-500">Estimadas a partir da data de criação de cada link anual ativo (+12 meses)</p>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Responsável</TableHead><TableHead>Plano</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Renovação estimada</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
        <TableBody>
          {annualRenewals.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-slate-500">Nenhum contrato anual ativo no momento.</TableCell></TableRow>}
          {annualRenewals.map(({ link, renewalDate }) => {
            const daysLeft = Math.round((renewalDate.getTime() - today) / (1000 * 60 * 60 * 24));
            const urgent = daysLeft <= 30;
            return (
              <TableRow key={link.id}>
                <TableCell className="font-medium">{actorName(link.actor_id)}</TableCell>
                <TableCell>{link.display_name}</TableCell>
                <TableCell className="text-right">{money.format(link.value)}</TableCell>
                <TableCell>{renewalDate.toLocaleDateString("pt-BR")}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={urgent ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600"}>
                    {daysLeft < 0 ? "Vencida" : `${daysLeft} dias`}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
