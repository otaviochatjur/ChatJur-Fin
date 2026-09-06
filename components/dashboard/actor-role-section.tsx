"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { ActorWorkspace } from "@/components/dashboard/actor-workspace";
import { ColumnVisibilityMenu, ResizableTh, useColumnVisibility, useColumnWidths, type ColumnDef } from "@/components/dashboard/table-toolbar";
import { actorCategoryLabel, money, type ActorMetrics, type CommercialActor, type Plan } from "@/lib/metrics";

const actorStatusFilters = ["ALL", "ACTIVE", "INACTIVE"] as const;
const actorStatusFilterLabels: Record<(typeof actorStatusFilters)[number], string> = { ALL: "Todos", ACTIVE: "Ativos", INACTIVE: "Inativos" };

const actorRoleColumns: ColumnDef<"clients" | "mrr" | "links" | "status">[] = [
  { key: "clients", label: "Clientes", defaultWidth: 110 },
  { key: "mrr", label: "MRR", defaultWidth: 130 },
  { key: "links", label: "Links", defaultWidth: 100 },
  { key: "status", label: "Status", defaultWidth: 120 },
];

/**
 * Generic "list + workspace" layout shared by every commercial-actor
 * category (Parceiros, Embaixadores, Institucional, Comercial interno,
 * Comercial externo) — replaces what used to be 4 near-identical
 * copy-pasted section components. Each category only differs in role,
 * copy and whether the quick-add dialog collects an e-mail.
 */
export function ActorRoleSection({
  actors,
  role,
  metrics,
  plans,
  onChanged,
  title,
  subtitle,
  addLabel,
  dialogTitle,
  dialogDescription,
  emptyMessage,
  columnLabel,
  showEmailField = false,
}: {
  actors: CommercialActor[];
  role: CommercialActor["role"];
  metrics: Record<string, ActorMetrics>;
  plans: Plan[];
  onChanged: () => void;
  title: string;
  subtitle: string;
  addLabel: string;
  dialogTitle: string;
  dialogDescription: string;
  emptyMessage: string;
  emptyWorkspaceMessage: string;
  columnLabel: string;
  showEmailField?: boolean;
}) {
  const scoped = actors.filter((actor) => actor.role === role);
  const [selectedIdRaw, setSelectedId] = useState("");
  // Derived at render time instead of synced via an effect — matches the
  // pattern already used across the dashboard's other list+workspace panes.
  const selectedId = selectedIdRaw && scoped.some((actor) => actor.id === selectedIdRaw) ? selectedIdRaw : "";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof actorStatusFilters)[number]>("ALL");
  const columns = useColumnVisibility(actorRoleColumns);
  const widths = useColumnWidths(actorRoleColumns);

  const term = search.trim().toLowerCase();
  const filtered = scoped
    .filter((actor) => statusFilter === "ALL" || actor.status === statusFilter)
    .filter((actor) => !term || actor.name.toLowerCase().includes(term));

  const current = scoped.find((actor) => actor.id === selectedId);
  const currentMetrics = current ? metrics[current.id] ?? { clients: 0, mrr: 0, links: 0 } : { clients: 0, mrr: 0, links: 0 };

  async function addActor() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const response = await fetch("/api/commercial-actors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, role, email: showEmailField && email.trim() ? email.trim() : undefined }),
    });
    const data = await response.json();
    if (!response.ok) { toast.error(data.error ?? "Não foi possível cadastrar."); return; }
    toast.success("Cadastrado com sucesso.");
    setName(""); setEmail(""); setDialogOpen(false); setSelectedId(data.actor.id);
    onChanged();
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild><Button className="bg-[#3a5d9d] text-white hover:bg-[#2c4a80]"><Plus className="size-4" />{addLabel}</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{dialogTitle}</DialogTitle><DialogDescription>{dialogDescription}</DialogDescription></DialogHeader>
              <div className="space-y-3">
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome completo" />
                {showEmailField && <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail (opcional)" type="email" />}
              </div>
              <DialogFooter><Button onClick={addActor}>{dialogTitle}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          {actorStatusFilters.map((value) => (
            <button key={value} onClick={() => setStatusFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${statusFilter === value ? "bg-[#eaf1fc] text-[#2c4a80]" : "text-slate-500 hover:bg-slate-50"}`}>
              {actorStatusFilterLabels[value]}
            </button>
          ))}
          <Input className="ml-auto w-56" placeholder="Buscar pelo nome" value={search} onChange={(event) => setSearch(event.target.value)} />
          <ColumnVisibilityMenu defs={actorRoleColumns} isVisible={columns.isVisible} toggle={columns.toggle} />
        </div>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <ResizableTh width={widths.getWidth("primary", 220)} onResizeStart={widths.startResize("primary", 220)}>{columnLabel}</ResizableTh>
              {columns.isVisible("clients") && <ResizableTh width={widths.getWidth("clients")} onResizeStart={widths.startResize("clients")} className="text-right">Clientes</ResizableTh>}
              {columns.isVisible("mrr") && <ResizableTh width={widths.getWidth("mrr")} onResizeStart={widths.startResize("mrr")} className="text-right">MRR</ResizableTh>}
              {columns.isVisible("links") && <ResizableTh width={widths.getWidth("links")} onResizeStart={widths.startResize("links")} className="text-right">Links</ResizableTh>}
              {columns.isVisible("status") && <ResizableTh width={widths.getWidth("status")} onResizeStart={widths.startResize("status")}>Status</ResizableTh>}
              <TableHead className="w-14" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={columns.visibleCount + 2} className="text-center text-sm text-slate-500">{scoped.length === 0 ? emptyMessage : "Nenhum cadastro nesse filtro."}</TableCell></TableRow>}
            {filtered.map((actor) => {
              const actorMetrics = metrics[actor.id] ?? { clients: 0, mrr: 0, links: 0 };
              return (
                <TableRow key={actor.id} className={actor.id === selectedId ? "bg-[#eef4fd]" : ""}>
                  <TableCell><button onClick={() => setSelectedId(actor.id)} className="text-left"><p className="font-medium">{actor.name}</p><p className="text-xs text-slate-500">{actorCategoryLabel(actor)}</p></button></TableCell>
                  {columns.isVisible("clients") && <TableCell className="text-right">{actorMetrics.clients}</TableCell>}
                  {columns.isVisible("mrr") && <TableCell className="text-right font-medium">{money.format(actorMetrics.mrr)}</TableCell>}
                  {columns.isVisible("links") && <TableCell className="text-right">{actorMetrics.links}</TableCell>}
                  {columns.isVisible("status") && <TableCell><StatusBadge status={actor.status} /></TableCell>}
                  <TableCell><Button onClick={() => setSelectedId(actor.id)} variant="ghost" size="icon"><ChevronRight className="size-4" /><span className="sr-only">Abrir</span></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      <Dialog open={Boolean(current)} onOpenChange={open => { if (!open) setSelectedId(""); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader><DialogTitle>{current?.name ?? "Detalhes"}</DialogTitle><DialogDescription>Cadastro, preços, links e clientes.</DialogDescription></DialogHeader>
          {current && <ActorWorkspace key={current.id} actor={current} plans={plans} metrics={currentMetrics} onChanged={onChanged} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
