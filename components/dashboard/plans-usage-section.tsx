"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { money, type CommercialActor, type PaymentLink, type Plan } from "@/lib/metrics";

const linkFilters = ["ALL", "PENDING", "ACTIVE", "INACTIVE"] as const;
const linkFilterLabels: Record<(typeof linkFilters)[number], string> = { ALL: "Todos", PENDING: "Pendentes", ACTIVE: "Vinculados", INACTIVE: "Inativos" };

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
  const [form, setForm] = useState({ code: "", name: "", billingPeriod: "MONTHLY" as "MONTHLY" | "ANNUAL", standardValue: "", annualInstallmentLimit: "6" });

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
    setForm({ code: "", name: "", billingPeriod: "MONTHLY", standardValue: "", annualInstallmentLimit: "6" });
  }

  async function createPlan() {
    setCreating(true);
    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: form.code, name: form.name, billingPeriod: form.billingPeriod, standardValue: Number(form.standardValue), annualInstallmentLimit: form.billingPeriod === "ANNUAL" ? Number(form.annualInstallmentLimit) : null }),
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
      body: JSON.stringify({ id: plan.id, name: patch.name, standardValue: Number(patch.standardValue), annualInstallmentLimit: plan.billing_period === "ANNUAL" ? Number(patch.annualInstallmentLimit) : null }),
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
        <Select value={form.billingPeriod} onValueChange={(value) => setForm((current) => ({ ...current, billingPeriod: value as "MONTHLY" | "ANNUAL" }))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="MONTHLY">Mensal</SelectItem>
            <SelectItem value="ANNUAL">Anual</SelectItem>
          </SelectContent>
        </Select>
        <Input className="w-36" type="number" min="0.01" step="0.01" placeholder="Valor padrão" value={form.standardValue} onChange={(event) => setForm((current) => ({ ...current, standardValue: event.target.value }))} />
        {form.billingPeriod === "ANNUAL" && <Input className="w-24" type="number" min="1" max="12" placeholder="Até Nx" value={form.annualInstallmentLimit} onChange={(event) => setForm((current) => ({ ...current, annualInstallmentLimit: event.target.value }))} />}
        <Button disabled={creating || !form.code.trim() || !form.name.trim() || !(Number(form.standardValue) > 0)} onClick={createPlan} className="bg-[#3a5d9d] text-white hover:bg-[#2c4a80]">{creating ? "Criando…" : "+ Novo plano"}</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Plano</TableHead><TableHead>Periodicidade</TableHead><TableHead className="text-right">Preço padrão</TableHead><TableHead>Parcelamento</TableHead><TableHead className="text-right">Links ativos</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
        </TableHeader>
        <TableBody>
          {!loading && plans.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-slate-500">Nenhum plano cadastrado ainda.</TableCell></TableRow>}
          {plans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              activeLinks={activeLinkCountByPlan.get(plan.id) ?? 0}
              editing={editingId === plan.id}
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

function PlanRow({ plan, activeLinks, editing, onEdit, onCancelEdit, onSave, onToggleStatus }: {
  plan: Plan;
  activeLinks: number;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: { name: string; standardValue: string; annualInstallmentLimit: string }) => void;
  onToggleStatus: () => void;
}) {
  const [name, setName] = useState(plan.name);
  const [standardValue, setStandardValue] = useState(String(plan.standard_value));
  const [annualInstallmentLimit, setAnnualInstallmentLimit] = useState(String(plan.annual_installment_limit ?? 6));

  if (editing) {
    return (
      <TableRow>
        <TableCell><Input value={name} onChange={(event) => setName(event.target.value)} /></TableCell>
        <TableCell><Badge variant="outline">{plan.billing_period === "ANNUAL" ? "Anual" : "Mensal"}</Badge></TableCell>
        <TableCell className="text-right"><Input className="text-right" type="number" min="0.01" step="0.01" value={standardValue} onChange={(event) => setStandardValue(event.target.value)} /></TableCell>
        <TableCell>{plan.billing_period === "ANNUAL" ? <Input type="number" min="1" max="12" value={annualInstallmentLimit} onChange={(event) => setAnnualInstallmentLimit(event.target.value)} /> : "—"}</TableCell>
        <TableCell className="text-right">{activeLinks}</TableCell>
        <TableCell><StatusBadge status={plan.status} /></TableCell>
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
      <TableCell><Badge variant="outline">{plan.billing_period === "ANNUAL" ? "Anual" : "Mensal"}</Badge></TableCell>
      <TableCell className="text-right">{money.format(plan.standard_value)}</TableCell>
      <TableCell>{plan.annual_installment_limit ? `até ${plan.annual_installment_limit}x` : "—"}</TableCell>
      <TableCell className="text-right">{activeLinks}</TableCell>
      <TableCell><StatusBadge status={plan.status} /></TableCell>
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
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetch("/api/plans?status=all").then((response) => response.json()).then((data) => setPlans(data.plans ?? [])).catch(() => setPlans([]));
  }, [links]);

  const filtered = filter === "ALL" ? links : links.filter((link) => link.status === filter);
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

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <h2 className="font-semibold">Links de pagamento</h2>
          <p className="mt-1 text-sm text-slate-500">{pendingCount > 0 ? `${pendingCount} link(s) pendente(s) de vinculação` : "Todos os links estão vinculados"}</p>
        </div>
        <Button variant="outline" size="sm" disabled={syncing} onClick={syncFromAsaas}>{syncing ? "Sincronizando…" : "Sincronizar links do Asaas"}</Button>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
        {linkFilters.map((value) => (
          <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${filter === value ? "bg-[#eaf1fc] text-[#2c4a80]" : "text-slate-500 hover:bg-slate-50"}`}>
            {linkFilterLabels[value]}{value === "PENDING" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Link</TableHead><TableHead>Ator</TableHead><TableHead>Plano</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Origem</TableHead><TableHead>Status</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-slate-500">Nenhum link nesse filtro.</TableCell></TableRow>}
          {filtered.map((link) => (
            <TableRow key={link.id}>
              <TableCell className="max-w-[240px] truncate font-medium" title={link.display_name}>{link.display_name}</TableCell>
              <TableCell>
                <Select value={link.actor_id ?? "none"} onValueChange={(value) => bind(link, { actorId: value === "none" ? null : value })}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="Sem ator" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem ator</SelectItem>
                    {actors.map((actor) => <SelectItem key={actor.id} value={actor.id}>{actor.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select value={link.plan_id ?? "none"} onValueChange={(value) => bind(link, { planId: value === "none" ? null : value })}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="Sem plano" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem plano</SelectItem>
                    {plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="text-right text-sm">{money.format(link.value)}<span className="ml-1 text-xs text-slate-400">{link.billing_period === "ANNUAL" ? "/ano" : "/mês"}</span></TableCell>
              <TableCell className="text-xs text-slate-500">{link.source === "ASAAS_SYNC" ? "Importado do Asaas" : "Gerado aqui"}</TableCell>
              <TableCell><StatusBadge status={link.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
