"use client";

import { useState } from "react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColumnVisibilityMenu, ResizableTh, useColumnVisibility, useColumnWidths, type ColumnDef } from "@/components/dashboard/table-toolbar";
import { money, type CommercialActor, type PaymentLink } from "@/lib/metrics";

function addYears(iso: string, years: number) {
  const date = new Date(iso);
  date.setFullYear(date.getFullYear() + years);
  return date;
}

const urgencyFilters = ["ALL", "URGENT", "NORMAL"] as const;
const urgencyFilterLabels: Record<(typeof urgencyFilters)[number], string> = { ALL: "Todas", URGENT: "Até 30 dias", NORMAL: "Mais de 30 dias" };

const renewalColumns: ColumnDef<"plan" | "value" | "renewalDate" | "status">[] = [
  { key: "plan", label: "Plano", defaultWidth: 260 },
  { key: "value", label: "Valor", defaultWidth: 130 },
  { key: "renewalDate", label: "Renovação estimada", defaultWidth: 170 },
  { key: "status", label: "Situação", defaultWidth: 130 },
];

export function RenewalsSection({ links, actors }: { links: PaymentLink[]; actors: CommercialActor[] }) {
  const [actorFilter, setActorFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState<(typeof urgencyFilters)[number]>("ALL");
  const columns = useColumnVisibility(renewalColumns);
  const widths = useColumnWidths(renewalColumns);

  const actorName = (id: string | null) => actors.find((actor) => actor.id === id)?.name ?? "—";
  // Wall-clock time only drives a display label (days remaining), not
  // memoized derived state, so a single narrowly-scoped exception is safe.
  // eslint-disable-next-line react-hooks/purity
  const today = Date.now();

  const annualRenewals = links
    .filter((link) => link.status === "ACTIVE" && link.billing_period === "ANNUAL")
    .filter((link) => actorFilter === "all" || link.actor_id === actorFilter)
    .map((link) => ({ link, renewalDate: addYears(link.created_at, 1) }))
    .filter(({ renewalDate }) => {
      if (urgencyFilter === "ALL") return true;
      const daysLeft = Math.round((renewalDate.getTime() - today) / (1000 * 60 * 60 * 24));
      return urgencyFilter === "URGENT" ? daysLeft <= 30 : daysLeft > 30;
    })
    .sort((a, b) => a.renewalDate.getTime() - b.renewalDate.getTime());

  const actorsWithAnnualLinks = actors.filter((actor) => links.some((link) => link.actor_id === actor.id && link.billing_period === "ANNUAL" && link.status === "ACTIVE"));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-semibold">Renovações de contratos anuais</h2>
        <p className="mt-1 text-sm text-slate-500">Estimadas a partir da data de criação de cada link anual ativo (+12 meses)</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        {urgencyFilters.map((value) => (
          <button key={value} onClick={() => setUrgencyFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${urgencyFilter === value ? "bg-[#eaf1fc] text-[#2c4a80]" : "text-slate-500 hover:bg-slate-50"}`}>
            {urgencyFilterLabels[value]}
          </button>
        ))}
        <Select value={actorFilter} onValueChange={setActorFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Responsável" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os responsáveis</SelectItem>
            {actorsWithAnnualLinks.map((actor) => <SelectItem key={actor.id} value={actor.id}>{actor.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <ColumnVisibilityMenu defs={renewalColumns} isVisible={columns.isVisible} toggle={columns.toggle} />
      </div>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <ResizableTh width={widths.getWidth("responsible", 190)} onResizeStart={widths.startResize("responsible", 190)}>Responsável</ResizableTh>
            {columns.isVisible("plan") && <ResizableTh width={widths.getWidth("plan")} onResizeStart={widths.startResize("plan")}>Plano</ResizableTh>}
            {columns.isVisible("value") && <ResizableTh width={widths.getWidth("value")} onResizeStart={widths.startResize("value")} className="text-right">Valor</ResizableTh>}
            {columns.isVisible("renewalDate") && <ResizableTh width={widths.getWidth("renewalDate")} onResizeStart={widths.startResize("renewalDate")}>Renovação estimada</ResizableTh>}
            {columns.isVisible("status") && <ResizableTh width={widths.getWidth("status")} onResizeStart={widths.startResize("status")}>Situação</ResizableTh>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {annualRenewals.length === 0 && <TableRow><TableCell colSpan={columns.visibleCount + 1} className="text-center text-sm text-slate-500">Nenhum contrato anual ativo nesse filtro.</TableCell></TableRow>}
          {annualRenewals.map(({ link, renewalDate }) => {
            const daysLeft = Math.round((renewalDate.getTime() - today) / (1000 * 60 * 60 * 24));
            const urgent = daysLeft <= 30;
            return (
              <TableRow key={link.id}>
                <TableCell className="font-medium">{actorName(link.actor_id)}</TableCell>
                {columns.isVisible("plan") && <TableCell>{link.display_name}</TableCell>}
                {columns.isVisible("value") && <TableCell className="text-right">{money.format(link.value)}</TableCell>}
                {columns.isVisible("renewalDate") && <TableCell>{renewalDate.toLocaleDateString("pt-BR")}</TableCell>}
                {columns.isVisible("status") && (
                  <TableCell>
                    <Badge variant="outline" className={urgent ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600"}>
                      {daysLeft < 0 ? "Vencida" : `${daysLeft} dias`}
                    </Badge>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
