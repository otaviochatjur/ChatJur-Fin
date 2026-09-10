"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2Off } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger, ComboboxValue } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { ColumnVisibilityMenu, ResizableTh, useTableSort, useColumnVisibility, useColumnWidths, type ColumnDef } from "@/components/dashboard/table-toolbar";
import { cn } from "@/lib/utils";
import { isOneTimePlanKind, money, planBadgeClass, planKindLabels, type CommercialActor, type PaymentLink, type Plan } from "@/lib/metrics";

type ComboOption = { value: string; label: string };

/** Searchable trigger+popup select (see the Cliente filter on Visão geral) — used here for the actor filter and the per-row actor/plan pickers, all of which can have 50-100+ options that a plain `<select>` makes unusable. */
function EntitySelect({ value, onValueChange, options, placeholder, className }: { value: string; onValueChange: (value: string) => void; options: ComboOption[]; placeholder: string; className?: string }) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <Combobox items={options} value={selected} onValueChange={(item) => onValueChange(item?.value ?? options[0].value)} limit={50}>
      <ComboboxTrigger className={cn("flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs text-left dark:bg-input/30 dark:hover:bg-input/50", className)}>
        <ComboboxValue placeholder={placeholder} />
      </ComboboxTrigger>
      <ComboboxContent>
        <div className="p-1"><ComboboxInput placeholder="Buscar…" showTrigger={false} className="w-full" /></div>
        <ComboboxEmpty>Nenhum resultado.</ComboboxEmpty>
        <ComboboxList>{(item: ComboOption) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

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
      <PlansPanel links={links} onChanged={onChanged} />
      <LinksPanel links={links} actors={actors} onChanged={onChanged} />
    </div>
  );
}

/** Bulk ACTIVE/INACTIVE toggle for every link bound to a plan or to an actor — used both by the plan catalog's "Desativar links vinculados" and by the actor workspace's equivalent action. Mirrors each link onto Asaas (see `app/api/asaas/payment-links/bulk-status`). */
async function bulkSetLinkStatus(target: { planId?: string; actorId?: string }, status: "ACTIVE" | "INACTIVE") {
  const response = await fetch("/api/asaas/payment-links/bulk-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...target, status }),
  });
  const data = await response.json();
  if (!response.ok) { toast.error(data.error ?? "Não foi possível atualizar os links."); return false; }
  if (data.total === 0) { toast.info("Nenhum link para atualizar."); return false; }
  const failedNote = data.failed.length > 0 ? ` ${data.failed.length} falharam: ${data.failed.join(", ")}.` : "";
  toast.success(`${data.succeeded}/${data.total} link(s) ${status === "INACTIVE" ? "desativado(s)" : "reativado(s)"} (no Asaas também).${failedNote}`);
  return true;
}

function PlansPanel({ links, onChanged }: { links: PaymentLink[]; onChanged: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", kind: "RECURRING" as Plan["kind"], billingPeriod: "MONTHLY" as "MONTHLY" | "ANNUAL", standardValue: "", annualInstallmentLimit: "6" });
  const [kindFilter, setKindFilter] = useState<(typeof planKindFilters)[number]>("ALL");
  const [statusFilter, setStatusFilter] = useState<(typeof planStatusFilters)[number]>("ALL");
  const columns = useColumnVisibility(planColumns);
  const widths = useColumnWidths(planColumns);
  const sorting = useTableSort();

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
    <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 dark:border-border p-5">
        <h2 className="font-semibold">Catálogo de planos</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">Cadastre aqui os planos existentes para depois vincular os links de pagamento a eles.</p>
      </div>
      <div className="border-b border-slate-100 dark:border-border bg-slate-50/60 p-4 dark:bg-input/10">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-muted-foreground">Novo plano</p>
      <div className="flex flex-wrap items-end gap-2">
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
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-border p-4">
        {planKindFilters.map((value) => (
          <button key={value} onClick={() => setKindFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${kindFilter === value ? "bg-accent text-accent-foreground" : "text-slate-500 dark:text-muted-foreground hover:bg-slate-50 dark:hover:bg-muted"}`}>
            {planKindFilterLabels[value]}
          </button>
        ))}
        <span className="h-5 w-px bg-slate-200 dark:bg-accent" />
        {planStatusFilters.map((value) => (
          <button key={value} onClick={() => setStatusFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${statusFilter === value ? "bg-accent text-accent-foreground" : "text-slate-500 dark:text-muted-foreground hover:bg-slate-50 dark:hover:bg-muted"}`}>
            {planStatusFilterLabels[value]}
          </button>
        ))}
        <ColumnVisibilityMenu defs={planColumns} isVisible={columns.isVisible} toggle={columns.toggle} />
      </div>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <ResizableTh {...sorting.header("plan")} width={widths.getWidth("plan", 240)} onResizeStart={widths.startResize("plan", 240)}>Plano</ResizableTh>
            {columns.isVisible("kind") && <ResizableTh {...sorting.header("kind")} width={widths.getWidth("kind")} onResizeStart={widths.startResize("kind")}>Tipo</ResizableTh>}
            {columns.isVisible("billingPeriod") && <ResizableTh {...sorting.header("billingPeriod")} width={widths.getWidth("billingPeriod")} onResizeStart={widths.startResize("billingPeriod")}>Periodicidade</ResizableTh>}
            {columns.isVisible("value") && <ResizableTh {...sorting.header("value")} width={widths.getWidth("value")} onResizeStart={widths.startResize("value")} className="text-right">Preço padrão</ResizableTh>}
            {columns.isVisible("installments") && <ResizableTh {...sorting.header("installments")} width={widths.getWidth("installments")} onResizeStart={widths.startResize("installments")}>Parcelamento</ResizableTh>}
            {columns.isVisible("activeLinks") && <ResizableTh {...sorting.header("activeLinks")} width={widths.getWidth("activeLinks")} onResizeStart={widths.startResize("activeLinks")} className="text-right">Links ativos</ResizableTh>}
            {columns.isVisible("status") && <ResizableTh {...sorting.header("status")} width={widths.getWidth("status")} onResizeStart={widths.startResize("status")}>Status</ResizableTh>}
            <TableHead className="w-[168px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loading && plans.length === 0 && <TableRow><TableCell colSpan={columns.visibleCount + 2} className="text-center text-sm text-slate-500 dark:text-muted-foreground">Nenhum plano cadastrado ainda.</TableCell></TableRow>}
          {sorting.rows(plans.filter((plan) => (kindFilter === "ALL" || plan.kind === kindFilter) && (statusFilter === "ALL" || plan.status === statusFilter)), plan => ({ plan: plan.name, kind: planKindLabels[plan.kind], billingPeriod: plan.billing_period === "ANNUAL" ? "Anual" : plan.billing_period === "ONE_TIME" ? "Taxa única" : "Mensal", value: plan.standard_value == null ? null : Number(plan.standard_value), installments: plan.billing_period === "ANNUAL" || isOneTimePlanKind(plan.kind) ? plan.annual_installment_limit ?? 6 : null, activeLinks: activeLinkCountByPlan.get(plan.id) ?? 0, status: plan.status === "ACTIVE" ? "Ativo" : "Inativo" })).map((plan) => (
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
              onDeactivateLinks={async () => {
                if (!window.confirm(`Desativar todos os ${activeLinkCountByPlan.get(plan.id) ?? 0} link(s) ativo(s) do plano "${plan.name}"? Eles deixam de aceitar pagamento no Asaas também — assinaturas já existentes não são afetadas.`)) return;
                if (await bulkSetLinkStatus({ planId: plan.id }, "INACTIVE")) onChanged();
              }}
            />
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function PlanRow({ plan, activeLinks, editing, visibleColumns, onEdit, onCancelEdit, onSave, onToggleStatus, onDeactivateLinks }: {
  plan: Plan;
  activeLinks: number;
  editing: boolean;
  visibleColumns: (key: "kind" | "billingPeriod" | "value" | "installments" | "activeLinks" | "status") => boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: { name: string; standardValue: string; annualInstallmentLimit: string }) => void;
  onToggleStatus: () => void;
  onDeactivateLinks: () => void;
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
      <TableCell className="font-medium">{plan.name}</TableCell>
      {visibleColumns("kind") && <TableCell><Badge variant="outline" className={planBadgeClass(plan)}>{planKindLabels[plan.kind]}</Badge></TableCell>}
      {visibleColumns("billingPeriod") && <TableCell><Badge variant="outline">{billingPeriodLabel}</Badge></TableCell>}
      {visibleColumns("value") && <TableCell className="text-right">{plan.standard_value != null ? money.format(plan.standard_value) : <span className="text-slate-400">Varia por link</span>}</TableCell>}
      {visibleColumns("installments") && <TableCell>{plan.annual_installment_limit ? `até ${plan.annual_installment_limit}x` : "—"}</TableCell>}
      {visibleColumns("activeLinks") && <TableCell className="text-right">{activeLinks}</TableCell>}
      {visibleColumns("status") && <TableCell><StatusBadge status={plan.status} /></TableCell>}
      <TableCell className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onEdit}>Editar</Button>
        <Button size="sm" variant="outline" onClick={onToggleStatus}>{plan.status === "ACTIVE" ? "Desativar" : "Ativar"}</Button>
        {activeLinks > 0 && (
          <Button size="sm" variant="ghost" onClick={onDeactivateLinks} title="Desativar todos os links vinculados a este plano (também no Asaas)" className="text-red-600 dark:text-red-300 hover:text-red-700 dark:hover:text-red-300">
            <Link2Off className="size-4" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

type LinkDraft = { actorId?: string | null; planId?: string | null };

function LinksPanel({ links, actors, onChanged }: { links: PaymentLink[]; actors: CommercialActor[]; onChanged: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [filter, setFilter] = useState<(typeof linkFilters)[number]>("PENDING");
  const [kindFilter, setKindFilter] = useState<(typeof planKindFilters)[number]>("ALL");
  const [actorFilter, setActorFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  // Ator/plano escolhidos no <Select> ficam só em rascunho aqui — nada é
  // salvo até o operador clicar em "Vincular" (linha) ou "Vincular
  // selecionados" (lote). Evita vinculação acidental ao passar o mouse ou
  // clicar errado no dropdown.
  const [drafts, setDrafts] = useState<Record<string, LinkDraft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const columns = useColumnVisibility(linkColumns);
  const widths = useColumnWidths(linkColumns);
  const sorting = useTableSort();

  useEffect(() => {
    fetch("/api/plans?status=all").then((response) => response.json()).then((data) => setPlans(data.plans ?? [])).catch(() => setPlans([]));
  }, [links]);

  // Kept in sync with the latest props/state on every render (not inside an
  // effect — these need to be current *during* the render that follows a
  // state change, not one tick later) so the callbacks below can read fresh
  // data by id without needing `links`/`drafts` in their own dependency
  // list. That's what lets those callbacks keep a *stable* identity across
  // renders, which in turn is what lets `LinkRow` below be a real
  // `React.memo` win: a stable callback prop + unchanged per-row primitives
  // means React can skip re-rendering a row entirely — the whole point,
  // since each row renders two <Select> (actor + plan), and this table can
  // have 200+ rows.
  const linksRef = useRef(links);
  const draftsRef = useRef(drafts);
  useEffect(() => {
    linksRef.current = links;
    draftsRef.current = drafts;
  }, [links, drafts]);

  const planById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const term = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      links
        .filter((link) => filter === "ALL" || link.status === filter)
        .filter((link) => kindFilter === "ALL" || linkKind(link, planById) === kindFilter)
        .filter((link) => actorFilter === "all" || link.actor_id === actorFilter)
        .filter((link) => !term || link.display_name.toLowerCase().includes(term)),
    [links, filter, kindFilter, actorFilter, term, planById],
  );
  const pendingCount = useMemo(() => links.filter((link) => link.status === "PENDING").length, [links]);

  function draftFor(link: PaymentLink): LinkDraft {
    return drafts[link.id] ?? {};
  }
  function draftActorId(link: PaymentLink) {
    const draft = draftFor(link);
    return draft.actorId !== undefined ? draft.actorId : link.actor_id;
  }
  function draftPlanId(link: PaymentLink) {
    const draft = draftFor(link);
    return draft.planId !== undefined ? draft.planId : link.plan_id;
  }
  function isDirty(link: PaymentLink) {
    const draft = draftFor(link);
    return (draft.actorId !== undefined && draft.actorId !== link.actor_id) || (draft.planId !== undefined && draft.planId !== link.plan_id);
  }
  const setDraft = useCallback((linkId: string, patch: LinkDraft) => {
    setDrafts((current) => ({ ...current, [linkId]: { ...current[linkId], ...patch } }));
  }, []);
  function clearDraft(id: string) {
    setDrafts((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  const dirtySelectedCount = useMemo(
    () =>
      [...selected].filter((id) => {
        const link = links.find((l) => l.id === id);
        return link && isDirty(link);
      }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `isDirty` is a plain function recreated every render that only reads `drafts` (already listed); adding it here would just churn the memo on every render for no reason.
    [selected, links, drafts],
  );

  function syncFromAsaas() {
    window.dispatchEvent(new Event("nexo:sync-asaas-base"));
    toast.info("Acompanhe a sincronização de clientes, cobranças e links no indicador acima.");
  }

  /** Raw PATCH call, no toast/refresh side effects — shared by the single-row and bulk confirm flows so bulk can aggregate one summary toast instead of one per link. */
  async function applyBind(link: PaymentLink, patch: LinkDraft) {
    const response = await fetch("/api/asaas/payment-links", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: link.id, ...patch }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Não foi possível vincular.");
    // Vincular um plano retroage: quem já pagou por este link antes tem sua
    // assinatura (ou pagamento de implantação/consultoria) atualizada agora
    // — sem isso, repasse por plano e receita por plano ficariam errados
    // para clientes antigos. Ver comentário na rota da API.
    return data.backfilled as { subscriptions: number; implementationPayments: number } | null;
  }

  function backfillNote(subscriptions: number, implementationPayments: number) {
    if (subscriptions === 0 && implementationPayments === 0) return "";
    const parts = [subscriptions > 0 ? `${subscriptions} assinatura(s)` : null, implementationPayments > 0 ? `${implementationPayments} pagamento(s) de implantação/consultoria` : null].filter(Boolean);
    return ` ${parts.join(" e ")} de clientes que já pagaram por este link foram atualizados retroativamente.`;
  }

  // Takes an id (not the link object) and reads current data off the refs
  // above — that's what keeps this callback's identity stable across
  // renders (see the refs' comment) so it can be passed straight into a
  // memoized `LinkRow`.
  const confirmLink = useCallback(async (linkId: string) => {
    const link = linksRef.current.find((l) => l.id === linkId);
    if (!link) return;
    const draft = draftsRef.current[linkId] ?? {};
    const isDirtyNow = (draft.actorId !== undefined && draft.actorId !== link.actor_id) || (draft.planId !== undefined && draft.planId !== link.plan_id);
    if (!isDirtyNow) return;
    setConfirmingId(link.id);
    try {
      const backfilled = await applyBind(link, draft);
      clearDraft(link.id);
      setSelected((current) => { const next = new Set(current); next.delete(link.id); return next; });
      toast.success(`Link vinculado.${backfillNote(backfilled?.subscriptions ?? 0, backfilled?.implementationPayments ?? 0)}`);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível vincular.");
    } finally {
      setConfirmingId(null);
    }
  }, [onChanged]);

  async function confirmSelected() {
    const targets = [...selected].map((id) => links.find((l) => l.id === id)).filter((link): link is PaymentLink => !!link && isDirty(link));
    if (targets.length === 0) { toast.info("Nenhuma alteração pendente nas linhas selecionadas."); return; }
    setConfirmingBulk(true);
    let succeeded = 0;
    let subsTotal = 0;
    let implTotal = 0;
    const failed: string[] = [];
    try {
      for (const link of targets) {
        try {
          const backfilled = await applyBind(link, draftFor(link));
          succeeded += 1;
          subsTotal += backfilled?.subscriptions ?? 0;
          implTotal += backfilled?.implementationPayments ?? 0;
          clearDraft(link.id);
        } catch {
          failed.push(link.display_name);
        }
      }
      setSelected(new Set());
      const failedNote = failed.length > 0 ? ` ${failed.length} falharam: ${failed.join(", ")}.` : "";
      if (succeeded > 0) toast.success(`${succeeded} link(s) vinculado(s).${backfillNote(subsTotal, implTotal)}${failedNote}`);
      else toast.error(`Não foi possível vincular os links selecionados.${failedNote}`);
      onChanged();
    } finally {
      setConfirmingBulk(false);
    }
  }

  const toggleSelected = useCallback((id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const allFilteredSelected = filtered.length > 0 && filtered.every((link) => selected.has(link.id));
  function toggleSelectAll(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const link of filtered) { if (checked) next.add(link.id); else next.delete(link.id); }
      return next;
    });
  }

  /** Deactivating actually disables the link at Asaas too (see the PATCH route) — the payer genuinely can't use it anymore, so it's worth a confirmation. Reactivating doesn't need one. */
  const toggleLinkStatus = useCallback(async (linkId: string) => {
    const link = linksRef.current.find((l) => l.id === linkId);
    if (!link) return;
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
  }, [onChanged]);

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-border p-5">
        <div>
          <h2 className="font-semibold">Links de pagamento</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">{pendingCount > 0 ? `${pendingCount} link(s) pendente(s) de vinculação` : "Todos os links estão vinculados"}</p>
        </div>
        <div className="flex items-center gap-2">
          {dirtySelectedCount > 0 && (
            <Button size="sm" disabled={confirmingBulk} onClick={confirmSelected} className="bg-[#3a5d9d] text-white hover:bg-[#2c4a80]">
              {confirmingBulk ? "Vinculando…" : `Vincular selecionados (${dirtySelectedCount})`}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={syncFromAsaas}>Sincronizar links do Asaas</Button>
        </div>
      </div>
      <div className="space-y-2.5 border-b border-slate-100 dark:border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          {linkFilters.map((value) => (
            <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${filter === value ? "bg-accent text-accent-foreground" : "text-slate-500 dark:text-muted-foreground hover:bg-slate-50 dark:hover:bg-muted"}`}>
              {linkFilterLabels[value]}{value === "PENDING" && pendingCount > 0 ? ` (${pendingCount})` : ""}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {planKindFilters.map((value) => (
            <button key={value} onClick={() => setKindFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${kindFilter === value ? "bg-accent text-accent-foreground" : "text-slate-500 dark:text-muted-foreground hover:bg-slate-50 dark:hover:bg-muted"}`}>
              {planKindFilterLabels[value]}
            </button>
          ))}
          <span className="h-5 w-px bg-slate-200 dark:bg-accent" />
          <EntitySelect className="w-44" value={actorFilter} onValueChange={setActorFilter} placeholder="Ator" options={[{ value: "all", label: "Todos os atores" }, ...actors.map((actor) => ({ value: actor.id, label: actor.name }))]} />
          <Input className="ml-auto w-56" placeholder="Buscar pelo nome do link" value={search} onChange={(event) => setSearch(event.target.value)} />
          <ColumnVisibilityMenu defs={linkColumns} isVisible={columns.isVisible} toggle={columns.toggle} />
        </div>
      </div>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40px]"><Checkbox checked={allFilteredSelected} onCheckedChange={(checked) => toggleSelectAll(checked === true)} aria-label="Selecionar todos os links filtrados" /></TableHead>
            <ResizableTh {...sorting.header("link")} width={widths.getWidth("link", 260)} onResizeStart={widths.startResize("link", 260)}>Link</ResizableTh>
            {columns.isVisible("kind") && <ResizableTh {...sorting.header("kind")} width={widths.getWidth("kind")} onResizeStart={widths.startResize("kind")}>Tipo</ResizableTh>}
            {columns.isVisible("actor") && <ResizableTh {...sorting.header("actor")} width={widths.getWidth("actor")} onResizeStart={widths.startResize("actor")}>Ator</ResizableTh>}
            {columns.isVisible("plan") && <ResizableTh {...sorting.header("plan")} width={widths.getWidth("plan")} onResizeStart={widths.startResize("plan")}>Plano</ResizableTh>}
            {columns.isVisible("value") && <ResizableTh {...sorting.header("value")} width={widths.getWidth("value")} onResizeStart={widths.startResize("value")} className="text-right">Valor</ResizableTh>}
            {columns.isVisible("source") && <ResizableTh {...sorting.header("source")} width={widths.getWidth("source")} onResizeStart={widths.startResize("source")}>Origem</ResizableTh>}
            {columns.isVisible("status") && <ResizableTh {...sorting.header("status")} width={widths.getWidth("status")} onResizeStart={widths.startResize("status")}>Status</ResizableTh>}
            <TableHead className="w-[190px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && <TableRow><TableCell colSpan={columns.visibleCount + 3} className="text-center text-sm text-slate-500 dark:text-muted-foreground">Nenhum link nesse filtro.</TableCell></TableRow>}
          {sorting.rows(filtered, link => ({ link: link.display_name, kind: planKindLabels[linkKind(link, planById)], actor: actors.find(actor => actor.id === draftActorId(link))?.name, plan: planById.get(draftPlanId(link) ?? "")?.name, value: Number(link.value), source: link.source === "ASAAS_SYNC" ? "Importado do Asaas" : "Gerado aqui", status: link.status === "ACTIVE" ? "Ativo" : link.status === "PENDING" ? "Pendente" : "Inativo" })).map((link) => {
            const boundPlan = link.plan_id ? planById.get(link.plan_id) : undefined;
            return (
              <LinkRow
                key={link.id}
                link={link}
                kind={linkKind(link, planById)}
                boundPlanCode={boundPlan?.code ?? ""}
                dirty={isDirty(link)}
                selected={selected.has(link.id)}
                draftActorId={draftActorId(link)}
                draftPlanId={draftPlanId(link)}
                showKind={columns.isVisible("kind")}
                showActor={columns.isVisible("actor")}
                showPlan={columns.isVisible("plan")}
                showValue={columns.isVisible("value")}
                showSource={columns.isVisible("source")}
                showStatus={columns.isVisible("status")}
                actors={actors}
                plans={plans}
                confirming={confirmingId === link.id}
                toggling={togglingId === link.id}
                onToggleSelected={toggleSelected}
                onSetDraft={setDraft}
                onConfirm={confirmLink}
                onToggleStatus={toggleLinkStatus}
              />
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

/**
 * One payment-link row, `React.memo`-wrapped: this table can have 200+ rows
 * and each renders two <Select> (actor + plan), which was the single
 * biggest render/DOM cost on this screen. Every prop here is either a
 * primitive, a stable callback (see the refs comment in `LinksPanel`), or
 * an array that only changes identity when the underlying data actually
 * changes (`actors`, `plans`) — so typing in the search box, resizing a
 * column, or (de)selecting a *different* row's checkbox no longer
 * re-renders every row, only the ones whose own props actually changed.
 */
const LinkRow = memo(function LinkRow({
  link,
  kind,
  boundPlanCode,
  dirty,
  selected,
  draftActorId,
  draftPlanId,
  showKind,
  showActor,
  showPlan,
  showValue,
  showSource,
  showStatus,
  actors,
  plans,
  confirming,
  toggling,
  onToggleSelected,
  onSetDraft,
  onConfirm,
  onToggleStatus,
}: {
  link: PaymentLink;
  kind: Plan["kind"];
  boundPlanCode: string;
  dirty: boolean;
  selected: boolean;
  draftActorId: string | null;
  draftPlanId: string | null;
  showKind: boolean;
  showActor: boolean;
  showPlan: boolean;
  showValue: boolean;
  showSource: boolean;
  showStatus: boolean;
  actors: CommercialActor[];
  plans: Plan[];
  confirming: boolean;
  toggling: boolean;
  onToggleSelected: (id: string, checked: boolean) => void;
  onSetDraft: (id: string, patch: LinkDraft) => void;
  onConfirm: (id: string) => void;
  onToggleStatus: (id: string) => void;
}) {
  return (
    <TableRow className={dirty ? "bg-amber-50 dark:bg-amber-950/40" : undefined}>
      <TableCell><Checkbox checked={selected} onCheckedChange={(checked) => onToggleSelected(link.id, checked === true)} aria-label={`Selecionar ${link.display_name}`} /></TableCell>
      <TableCell className="max-w-[240px] truncate font-medium" title={link.display_name}>
        {link.display_name}
      </TableCell>
      {showKind && <TableCell><Badge variant="outline" className={planBadgeClass({ kind, code: boundPlanCode })}>{planKindLabels[kind]}</Badge></TableCell>}
      {showActor && (
        <TableCell>
          <EntitySelect className="w-44" value={draftActorId ?? "none"} onValueChange={(value) => onSetDraft(link.id, { actorId: value === "none" ? null : value })} placeholder="Sem ator" options={[{ value: "none", label: "Sem ator" }, ...actors.map((actor) => ({ value: actor.id, label: actor.name }))]} />
        </TableCell>
      )}
      {showPlan && (
        <TableCell>
          <EntitySelect className="w-44" value={draftPlanId ?? "none"} onValueChange={(value) => onSetDraft(link.id, { planId: value === "none" ? null : value })} placeholder="Sem plano" options={[{ value: "none", label: "Sem plano" }, ...plans.map((plan) => ({ value: plan.id, label: plan.name }))]} />
        </TableCell>
      )}
      {showValue && <TableCell className="text-right text-sm">{money.format(link.value)}<span className="ml-1 text-xs text-slate-400">{link.billing_period === "ANNUAL" ? "/ano" : link.billing_period === "ONE_TIME" ? " · taxa única" : "/mês"}</span></TableCell>}
      {showSource && <TableCell className="text-xs text-slate-500 dark:text-muted-foreground">{link.source === "ASAAS_SYNC" ? "Importado do Asaas" : "Gerado aqui"}</TableCell>}
      {showStatus && <TableCell><StatusBadge status={link.status} />{link.asaas_snapshot && <p className="mt-1 text-xs text-muted-foreground" title={link.asaas_synced_at ? `Consultado em ${new Date(link.asaas_synced_at).toLocaleString("pt-BR")}` : undefined}>Asaas: {link.asaas_snapshot.deleted ? "Removido" : link.asaas_snapshot.active === false ? "Inativo" : "Ativo"}</p>}</TableCell>}
      <TableCell className="flex justify-end gap-1.5">
        {dirty && (
          <Button size="sm" disabled={confirming} onClick={() => onConfirm(link.id)} className="bg-[#3a5d9d] text-white hover:bg-[#2c4a80]">
            {confirming ? "Vinculando…" : "Vincular"}
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={toggling} onClick={() => onToggleStatus(link.id)} className={link.status === "INACTIVE" ? "text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-300" : "text-red-600 dark:text-red-300 hover:text-red-700 dark:hover:text-red-300"}>
          {toggling ? "…" : link.status === "INACTIVE" ? "Reativar" : "Desativar"}
        </Button>
      </TableCell>
    </TableRow>
  );
});
