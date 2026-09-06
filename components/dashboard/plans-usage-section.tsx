"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { ColumnVisibilityMenu, ResizableTh, useColumnVisibility, useColumnWidths, type ColumnDef } from "@/components/dashboard/table-toolbar";
import { isOneTimePlanKind, money, planBadgeClass, planKindLabels, type CommercialActor, type PaymentLink, type Plan } from "@/lib/metrics";

const linkFilters = ["ALL", "PENDING", "ACTIVE", "INACTIVE"] as const;
const linkFilterLabels: Record<(typeof linkFilters)[number], string> = { ALL: "Todos", PENDING: "Pendentes", ACTIVE: "Vinculados", INACTIVE: "Inativos" };

const planKindFilters = ["ALL", "RECURRING", "IMPLEMENTATION", "CONSULTING"] as const;
const planKindFilterLabels: Record<(typeof planKindFilters)[number], string> = { ALL: "Todos", RECURRING: "Planos", IMPLEMENTATION: "Implantações", CONSULTING: "Consultorias" };

const planStatusFilters = ["ALL", "ACTIVE", "INACTIVE"] as const;
const planStatusFilterLabels: Record<(typeof planStatusFilters)[number], string> = { ALL: "Todos", ACTIVE: "Ativos", INACTIVE: "Inativos" };

const planColumns: ColumnDef<"kind" | "billingPeriod" | "value" | "installments" | "activeLinks" | "status">[] = [
  { key: "kind", label: "Tipo", defaultWidth: 150 },
  { key: "billingPeriod", label: "Periodicidade", defaultWidth: 130 },
  { key: "value", label: "Preço padrão", defaultWidth: 130 },
  { key: "installments", label: "Parcelamento", defaultWidth: 130 },
  { key: "activeLinks", label: "Links ativos", defaultWidth: 110 },
  { key: "status", label: "Status", defaultWidth: 110 },
];

const linkColumns: ColumnDef<"kind" | "actor" | "plan" | "value" | "source" | "status">[] = [
  { key: "kind", label: "Tipo", defaultWidth: 130 },
  { key: "actor", label: "Ator", defaultWidth: 190 },
  { key: "plan", label: "Plano", defaultWidth: 190 },
  { key: "value", label: "Valor", defaultWidth: 130 },
  { key: "source", label: "Origem", defaultWidth: 150 },
  { key: "status", label: "Status", defaultWidth: 110 },
];

/** A link's category for filtering/display purposes: the kind of the plan it's bound to, or "RECURRING" (shown as "Plano") for unbound links — matching `lib/payment-sync.ts`'s "unbound links behave like RECURRING" convention. */
function linkKind(link: PaymentLink, planById: Map<string, Plan>): Plan["kind"] {
  return (link.plan_id && planById.get(link.plan_id)?.kind) || "RECURRING";
}

export function PlansUsageSection({ links, actors, onChanged }: { links: PaymentLink[]; actors: CommercialActor[]; onChanged: () => void }) {
  return (
    <div className="space-y-5">
      <PlansPanel links={links} />
      <LinksPanel links={links} actors={actors} onChanged={onChanged} />
    </div>
  );
}

function PlansPanel({ links }: { links: PaymentLink[] }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", kind: "RECURRING" as Plan["kind"], billingPeriod: "MONTHLY" as "MONTHLY" | "ANNUAL", standardValue: "", annualInstallmentLimit: "6" });
  const [kindFilter, setKindFilter] = useState<(typeof planKindFilters)[number]>("ALL");
  const [statusFilter, setStatusFilter] = useState<(typeof planStatusFilters)[number]>("ALL");
  const columns = useColumnVisibility(planColumns);
  const widths = useColumnWidths(planColumns);

  async function loadPlans() {
    // No setState before this first await: keeps this effect-safe per
    // react-hooks/set-state-in-effect (facebook/react#34905) when called
    // directly from the mount effect below.
    const response = await fetch("/api/plans?status=all");
    const data = await response.json();
    setPlans(response.ok ? data.plans ?? [] : []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadPlans only calls setState after its internal await resolves.
    loadPlans();
  }, []);

  const activeLinkCountByPlan = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of links) {
      if (link.status !== "ACTIVE" || !link.plan_id) continue;
      map.set(link.plan_id, (map.get(link.plan_id) ?? 0) + 1);
    }
    return map;
  }, [links]);

  function resetForm() {
    setForm({ code: "", name: "", kind: "RECURRING", billingPeriod: "MONTHLY", standardValue: "", annualInstallmentLimit: "6" });
  }

  const showInstallments = isOneTimePlanKind(form.kind) || form.billingPeriod === "ANNUAL";

  async function createPlan() {
    setCreating(true);
    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: form.code, name: form.name, kind: form.kind, billingPeriod: form.billingPeriod, standardValue: form.standardValue.trim() ? Number(form.standardValue) : null, annualInstallmentLimit: showInstallments ? Number(form.annualInstallmentLimit) : null }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível criar o plano."); return; }
      toast.success("Plano criado.");
      resetForm();
      await loadPlans();
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(plan: Plan) {
    const response = await fetch("/api/plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: plan.id, status: plan.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
    });
    const data = await response.json();
    if (!response.ok) { toast.error(data.error ?? "Não foi possível atualizar."); return; }
    await loadPlans();
  }

  async function savePlanEdit(plan: Plan, patch: { name: string; standardValue: string; annualInstallmentLimit: string }) {
    const response = await fetch("/api/plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: plan.id, name: patch.name, standardValue: patch.standardValue.trim() ? Number(patch.standardValue) : null, annualInstallmentLimit: plan.billing_period === "ANNUAL" || isOneTimePlanKind(plan.kind) ? Number(patch.annualInstallmentLimit) : null }),
    });
    const data = await response.json();
    if (!response.ok) { toast.error(data.error ?? "Não foi possível salvar."); return; }
    toast.success("Plano atualizado.");
    setEditingId(null);
    await loadPlans();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-semibold">Catálogo de planos</h2>
        <p className="mt-1 text-sm text-slate-500">Cadastre aqui os planos existentes para depois vincular os links de pagamento a eles.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
        <Input className="w-28" placeholder="Código" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} />
        <Input className="flex-1 min-w-[180px]" placeholder="Nome do plano" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        <Select value={form.kind} onValueChange={(value) => setForm((current) => ({ ...current, kind: value as Plan["kind"] }))}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="RECURRING">Plano</SelectItem>
            <SelectItem value="IMPLEMENTATION">Implantação (taxa única)</SelectItem>
            <SelectItem value="CONSULTING">Consultoria (taxa única)</SelectItem>
          </SelectContent>
        </Select>
        {form.kind === "RECURRING" && (
          <Select value={form.billingPeriod} onValueChange={(value) => setForm((current) => ({ ...current, billingPeriod: value as "MONTHLY" | "ANNUAL" }))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MONTHLY">Mensal</SelectItem>
              <SelectItem value="ANNUAL">Anual</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Input className="w-40" type="number" min="0.01" step="0.01" placeholder={isOneTimePlanKind(form.kind) ? "Valor padrão (opcional)" : "Valor padrão"} value={form.standardValue} onChange={(event) => setForm((current) => ({ ...current, standardValue: event.target.value }))} />
        {showInstallments && <Input className="w-24" type="number" min="1" max="12" placeholder="Até Nx" value={form.annualInstallmentLimit} onChange={(event) => setForm((current) => ({ ...current, annualInstallmentLimit: event.target.value }))} />}
        <Button disabled={creating || !form.code.trim() || !form.name.trim() || (!isOneTimePlanKind(form.kind) && !(Number(form.standardValue) > 0))} onClick={createPlan} className="bg-[#3a5d9d] text-white hover:bg-[#2c4a80]">{creating ? "Criando…" : "+ Novo plano"}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        {planKindFilters.map((value) => (
          <button key={value} onClick={() => setKindFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${kindFilter === value ? "bg-[#eaf1fc] text-[#2c4a80]" : "text-slate-500 hover:bg-slate-50"}`}>
            {planKindFilterLabels[value]}
          </button>
        ))}
        <span className="h-5 w-px bg-slate-200" />
        {planStatusFilters.map((value) => (
          <button key={value} onClick={() => setStatusFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${statusFilter === value ? "bg-[#eaf1fc] text-[#2c4a80]" : "text-slate-500 hover:bg-slate-50"}`}>
            {planStatusFilterLabels[value]}
          </button>
        ))}
        <ColumnVisibilityMenu defs={planColumns} isVisible={columns.isVisible} toggle={columns.toggle} />
      </div>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <ResizableTh width={widths.getWidth("plan", 240)} onResizeStart={widths.startResize("plan", 240)}>Plano</ResizableTh>
            {columns.isVisible("kind") && <ResizableTh width={widths.getWidth("kind")} onResizeStart={widths.startResize("kind")}>Tipo</ResizableTh>}
            {columns.isVisible("billingPeriod") && <ResizableTh width={widths.getWidth("billingPeriod")} onResizeStart={widths.startResize("billingPeriod")}>Periodicidade</ResizableTh>}
            {columns.isVisible("value") && <ResizableTh width={widths.getWidth("value")} onResizeStart={widths.startResize("value")} className="text-right">Preço padrão</ResizableTh>}
            {columns.isVisible("installments") && <ResizableTh width={widths.getWidth("installments")} onResizeStart={widths.startResize("installments")}>Parcelamento</ResizableTh>}
            {columns.isVisible("activeLinks") && <ResizableTh width={widths.getWidth("activeLinks")} onResizeStart={widths.startResize("activeLinks")} className="text-right">Links ativos</ResizableTh>}
            {columns.isVisible("status") && <ResizableTh width={widths.getWidth("status")} onResizeStart={widths.startResize("status")}>Status</ResizableTh>}
            <TableHead className="w-[132px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loading && plans.length === 0 && <TableRow><TableCell colSpan={columns.visibleCount + 2} className="text-center text-sm text-slate-500">Nenhum plano cadastrado ainda.</TableCell></TableRow>}
          {plans.filter((plan) => (kindFilter === "ALL" || plan.kind === kindFilter) && (statusFilter === "ALL" || plan.status === statusFilter)).map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              activeLinks={activeLinkCountByPlan.get(plan.id) ?? 0}
              editing={editingId === plan.id}
              visibleColumns={columns.isVisible}
              onEdit={() => setEditingId(plan.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(patch) => savePlanEdit(plan, patch)}
              onToggleStatus={() => toggleStatus(plan)}
            />
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function PlanRow({ plan, activeLinks, editing, visibleColumns, onEdit, onCancelEdit, onSave, onToggleStatus }: {
  plan: Plan;
  activeLinks: number;
  editing: boolean;
  visibleColumns: (key: "kind" | "billingPeriod" | "value" | "installments" | "activeLinks" | "status") => boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: { name: string; standardValue: string; annualInstallmentLimit: string }) => void;
  onToggleStatus: () => void;
}) {
  const [name, setName] = useState(plan.name);
  const [standardValue, setStandardValue] = useState(plan.standard_value != null ? String(plan.standard_value) : "");
  const [annualInstallmentLimit, setAnnualInstallmentLimit] = useState(String(plan.annual_installment_limit ?? 6));
  const showInstallments = plan.billing_period === "ANNUAL" || isOneTimePlanKind(plan.kind);
  const billingPeriodLabel = plan.billing_period === "ANNUAL" ? "Anual" : plan.billing_period === "ONE_TIME" ? "Taxa única" : "Mensal";

  if (editing) {
    return (
      <TableRow>
        <TableCell><Input value={name} onChange={(event) => setName(event.target.value)} /></TableCell>
        {visibleColumns("kind") && <TableCell><Badge variant="outline" className={planBadgeClass(plan)}>{planKindLabels[plan.kind]}</Badge></TableCell>}
        {visibleColumns("billingPeriod") && <TableCell><Badge variant="outline">{billingPeriodLabel}</Badge></TableCell>}
        {visibleColumns("value") && <TableCell className="text-right"><Input className="text-right" type="number" min="0.01" step="0.01" placeholder={isOneTimePlanKind(plan.kind) ? "Opcional" : undefined} value={standardValue} onChange={(event) => setStandardValue(event.target.value)} /></TableCell>}
        {visibleColumns("installments") && <TableCell>{showInstallments ? <Input type="number" min="1" max="12" value={annualInstallmentLimit} onChange={(event) => setAnnualInstallmentLimit(event.target.value)} /> : "—"}</TableCell>}
        {visibleColumns("activeLinks") && <TableCell className="text-right">{activeLinks}</TableCell>}
        {visibleColumns("status") && <TableCell><StatusBadge status={plan.status} /></TableCell>}
        <TableCell className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCancelEdit}>Cancelar</Button>
          <Button size="sm" onClick={() => onSave({ name, standardValue, annualInstallmentLimit })}>Salvar</Button>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{plan.name} <span className="text-xs text-slate-400">· {plan.code}</span></TableCell>
      {visibleColumns("kind") && <TableCell><Badge variant="outline" className={planBadgeClass(plan)}>{planKindLabels[plan.kind]}</Badge></TableCell>}
      {visibleColumns("billingPeriod") && <TableCell><Badge variant="outline">{billingPeriodLabel}</Badge></TableCell>}
      {visibleColumns("value") && <TableCell className="text-right">{plan.standard_value != null ? money.format(plan.standard_value) : <span className="text-slate-400">Varia por link</span>}</TableCell>}
      {visibleColumns("installments") && <TableCell>{plan.annual_installment_limit ? `até ${plan.annual_installment_limit}x` : "—"}</TableCell>}
      {visibleColumns("activeLinks") && <TableCell className="text-right">{activeLinks}</TableCell>}
      {visibleColumns("status") && <TableCell><StatusBadge status={plan.status} /></TableCell>}
      <TableCell className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onEdit}>Editar</Button>
        <Button size="sm" variant="outline" onClick={onToggleStatus}>{plan.status === "ACTIVE" ? "Desativar" : "Ativar"}</Button>
      </TableCell>
    </TableRow>
  );
}

function LinksPanel({ links, actors, onChanged }: { links: PaymentLink[]; actors: CommercialActor[]; onChanged: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [filter, setFilter] = useState<(typeof linkFilters)[number]>("PENDING");
  const [kindFilter, setKindFilter] = useState<(typeof planKindFilters)[number]>("ALL");
  const [actorFilter, setActorFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const columns = useColumnVisibility(linkColumns);
  const widths = useColumnWidths(linkColumns);

  useEffect(() => {
    fetch("/api/plans?status=all").then((response) => response.json()).then((data) => setPlans(data.plans ?? [])).catch(() => setPlans([]));
  }, [links]);

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const term = search.trim().toLowerCase();
  const filtered = links
    .filter((link) => filter === "ALL" || link.status === filter)
    .filter((link) => kindFilter === "ALL" || linkKind(link, planById) === kindFilter)
    .filter((link) => actorFilter === "all" || link.actor_id === actorFilter)
    .filter((link) => !term || link.display_name.toLowerCase().includes(term));
  const pendingCount = links.filter((link) => link.status === "PENDING").length;

  async function syncFromAsaas() {
    setSyncing(true);
    try {
      const response = await fetch("/api/asaas/sync-links", { method: "POST" });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível sincronizar."); return; }
      toast.success(`${data.imported} link(s) novo(s) importado(s) de ${data.totalSeen} na conta Asaas.${data.skippedNoValue ? ` ${data.skippedNoValue} sem valor fixo foram ignorados.` : ""}`);
      onChanged();
    } finally {
      setSyncing(false);
    }
  }

  async function bind(link: PaymentLink, patch: { actorId?: string | null; planId?: string | null }) {
    const response = await fetch("/api/asaas/payment-links", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: link.id, ...patch }),
    });
    const data = await response.json();
    if (!response.ok) { toast.error(data.error ?? "Não foi possível vincular."); return; }
    onChanged();
  }

  /** Deactivating actually disables the link at Asaas too (see the PATCH route) — the payer genuinely can't use it anymore, so it's worth a confirmation. Reactivating doesn't need one. */
  async function toggleLinkStatus(link: PaymentLink) {
    const nextStatus = link.status === "INACTIVE" ? "ACTIVE" : "INACTIVE";
    if (nextStatus === "INACTIVE" && !window.confirm(`Desativar "${link.display_name}"? Ele deixa de aceitar pagamentos no Asaas também.`)) return;
    setTogglingId(link.id);
    try {
      const response = await fetch("/api/asaas/payment-links", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: link.id, status: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível atualizar o link."); return; }
      toast.success(nextStatus === "INACTIVE" ? "Link desativado (no Asaas também)." : "Link reativado (no Asaas também).");
      onChanged();
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <h2 className="font-semibold">Links de pagamento</h2>
          <p className="mt-1 text-sm text-slate-500">{pendingCount > 0 ? `${pendingCount} link(s) pendente(s) de vinculação` : "Todos os links estão vinculados"}</p>
        </div>
        <Button variant="outline" size="sm" disabled={syncing} onClick={syncFromAsaas}>{syncing ? "Sincronizando…" : "Sincronizar links do Asaas"}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        {linkFilters.map((value) => (
          <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${filter === value ? "bg-[#eaf1fc] text-[#2c4a80]" : "text-slate-500 hover:bg-slate-50"}`}>
            {linkFilterLabels[value]}{value === "PENDING" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        ))}
        <span className="h-5 w-px bg-slate-200" />
        {planKindFilters.map((value) => (
          <button key={value} onClick={() => setKindFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${kindFilter === value ? "bg-[#eaf1fc] text-[#2c4a80]" : "text-slate-500 hover:bg-slate-50"}`}>
            {planKindFilterLabels[value]}
          </button>
        ))}
        <Select value={actorFilter} onValueChange={setActorFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Ator" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os atores</SelectItem>
            {actors.map((actor) => <SelectItem key={actor.id} value={actor.id}>{actor.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="ml-auto w-56" placeholder="Buscar pelo nome do link" value={search} onChange={(event) => setSearch(event.target.value)} />
        <ColumnVisibilityMenu defs={linkColumns} isVisible={columns.isVisible} toggle={columns.toggle} />
      </div>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <ResizableTh width={widths.getWidth("link", 260)} onResizeStart={widths.startResize("link", 260)}>Link</ResizableTh>
            {columns.isVisible("kind") && <ResizableTh width={widths.getWidth("kind")} onResizeStart={widths.startResize("kind")}>Tipo</ResizableTh>}
            {columns.isVisible("actor") && <ResizableTh width={widths.getWidth("actor")} onResizeStart={widths.startResize("actor")}>Ator</ResizableTh>}
            {columns.isVisible("plan") && <ResizableTh width={widths.getWidth("plan")} onResizeStart={widths.startResize("plan")}>Plano</ResizableTh>}
            {columns.isVisible("value") && <ResizableTh width={widths.getWidth("value")} onResizeStart={widths.startResize("value")} className="text-right">Valor</ResizableTh>}
            {columns.isVisible("source") && <ResizableTh width={widths.getWidth("source")} onResizeStart={widths.startResize("source")}>Origem</ResizableTh>}
            {columns.isVisible("status") && <ResizableTh width={widths.getWidth("status")} onResizeStart={widths.startResize("status")}>Status</ResizableTh>}
            <TableHead className="w-[110px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && <TableRow><TableCell colSpan={columns.visibleCount + 2} className="text-center text-sm text-slate-500">Nenhum link nesse filtro.</TableCell></TableRow>}
          {filtered.map((link) => {
            const boundPlan = link.plan_id ? planById.get(link.plan_id) : undefined;
            const kind = linkKind(link, planById);
            return (
            <TableRow key={link.id}>
              <TableCell className="max-w-[240px] truncate font-medium" title={link.display_name}>
                {link.display_name}
              </TableCell>
              {columns.isVisible("kind") && <TableCell><Badge variant="outline" className={planBadgeClass({ kind, code: boundPlan?.code ?? "" })}>{planKindLabels[kind]}</Badge></TableCell>}
              {columns.isVisible("actor") && (
                <TableCell>
                  <Select value={link.actor_id ?? "none"} onValueChange={(value) => bind(link, { actorId: value === "none" ? null : value })}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="Sem ator" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem ator</SelectItem>
                      {actors.map((actor) => <SelectItem key={actor.id} value={actor.id}>{actor.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
              )}
              {columns.isVisible("plan") && (
                <TableCell>
                  <Select value={link.plan_id ?? "none"} onValueChange={(value) => bind(link, { planId: value === "none" ? null : value })}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="Sem plano" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem plano</SelectItem>
                      {plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
              )}
              {columns.isVisible("value") && <TableCell className="text-right text-sm">{money.format(link.value)}<span className="ml-1 text-xs text-slate-400">{link.billing_period === "ANNUAL" ? "/ano" : link.billing_period === "ONE_TIME" ? " · taxa única" : "/mês"}</span></TableCell>}
              {columns.isVisible("source") && <TableCell className="text-xs text-slate-500">{link.source === "ASAAS_SYNC" ? "Importado do Asaas" : "Gerado aqui"}</TableCell>}
              {columns.isVisible("status") && <TableCell><StatusBadge status={link.status} /></TableCell>}
              <TableCell>
                <Button variant="ghost" size="sm" disabled={togglingId === link.id} onClick={() => toggleLinkStatus(link)} className={link.status === "INACTIVE" ? "text-emerald-700 hover:text-emerald-800" : "text-red-600 hover:text-red-700"}>
                  {togglingId === link.id ? "…" : link.status === "INACTIVE" ? "Reativar" : "Desativar"}
                </Button>
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
