"use client";

import { useEffect, useMemo, useState } from "react";
import { CustomerTimeline } from "@/components/dashboard/customer-timeline";
import { activeCustomizations, itemCatalog, type ActiveCustomization, type CustomerActivity } from "@/lib/customer-activity";
import { Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ColumnVisibilityMenu, ResizableTh, useTableSort, useColumnVisibility, useColumnWidths, type ColumnDef } from "@/components/dashboard/table-toolbar";
import { isPaidStatus, money, monthlyValue, planBadgeClass, planKindLabels, roleLabels, type CommercialActor, type Customer, type ImplementationPayment, type Payment, type PaymentLink, type Plan, type Subscription } from "@/lib/metrics";
import { currentLinkedSubscriptions } from "@/lib/subscription-presentation";
import { localDate } from "@/lib/customer-activity";
import type { ClientSheetSyncResult } from "@/lib/client-sheet-sync";

const clientColumns: ColumnDef<"status" | "plan" | "mrr" | "actor" | "signedAt">[] = [
  { key: "status", label: "Status", defaultWidth: 120 },
  { key: "plan", label: "Plano", defaultWidth: 260 },
  { key: "mrr", label: "MRR", defaultWidth: 110 },
  { key: "actor", label: "Parceiro", defaultWidth: 160 },
  { key: "signedAt", label: "Assinado em", defaultWidth: 130 },
];

type ConfirmedStatus = "ACTIVE" | "CANCELLED" | "FROZEN";
const statusLabels: Record<ConfirmedStatus, string> = { ACTIVE: "Ativo", CANCELLED: "Cancelado", FROZEN: "Congelado" };
const statusBadgeClass: Record<ConfirmedStatus, string> = {
  ACTIVE: "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300",
  CANCELLED: "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300",
  FROZEN: "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300",
};
/** Both customers.status and subscriptions.status can be null (operator hasn't manually confirmed it yet, e.g. right after the Set/2026 reset) until the operator sets it or, for customers, a CANCELLATION activity auto-sets it. */
function statusLabelOrUnset(status: ConfirmedStatus | null) {
  return status ? statusLabels[status] : "Sem status";
}
function statusBadgeClassOrUnset(status: ConfirmedStatus | null) {
  return status ? statusBadgeClass[status] : "border-slate-200 dark:border-border bg-slate-50 dark:bg-muted text-slate-500 dark:text-muted-foreground";
}

function formatCustomization(item: ActiveCustomization) {
  const label = itemCatalog[item.kind].label;
  const qty = item.quantity !== null ? `${item.quantity > 0 ? "+" : ""}${item.quantity} ` : "";
  return `${qty}${label} · ${money.format(item.amount)}/mês`;
}

/** Subtle hover indicator for a plan that has add-ons on top of its base value (see `activeCustomizations`) — kept out of the way unless there's actually something to show. */
function CustomizationHint({ items }: { items: ActiveCustomization[] }) {
  if (!items.length) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} onClick={(event) => event.stopPropagation()} className="inline-flex shrink-0 cursor-help items-center rounded-full p-0.5 text-[#3b82f6] outline-none hover:bg-blue-50 dark:hover:bg-blue-950 focus-visible:bg-blue-50" aria-label="Plano personalizado em relação ao base">
            <SlidersHorizontal className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          <p className="font-medium">Personalizado em relação ao plano base</p>
          <ul className="mt-1 space-y-0.5 text-[11px]">{items.map((item) => <li key={item.kind}>{formatCustomization(item)}</li>)}</ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const dateOnly = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return dateOnly ? `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}` : new Date(value).toLocaleDateString("pt-BR");
}

function PaymentDates({ payment }: { payment: Pick<Payment, "payment_date" | "confirmed_date" | "due_date" | "refunded_at"> }) {
  const paidAt = payment.payment_date ?? payment.confirmed_date;
  return (
    <div className="text-right text-xs text-slate-500 dark:text-muted-foreground">
      <p>{paidAt ? `Pago em ${fmtDate(paidAt)}` : `Vencimento ${fmtDate(payment.due_date)}`}</p>
      {payment.refunded_at && <p className="font-medium text-red-600 dark:text-red-300">Estornado em {fmtDate(payment.refunded_at)}</p>}
    </div>
  );
}

type PaymentSyncRun = {
  action: "COMPLETED" | "FAILED";
  created_at: string;
  after_json: { linksTotal?: number; linksOk?: number; payments?: number; errors?: { linkId: string; message: string }[]; error?: string } | null;
};

function fmtDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ClientsSection({ customers, subscriptions, payments, implementationPayments, plans, actors, links, events, onChanged }: {
  customers: Customer[];
  subscriptions: Subscription[];
  payments: Payment[];
  implementationPayments: ImplementationPayment[];
  plans: Plan[];
  actors: CommercialActor[];
  links: PaymentLink[];
  events: CustomerActivity[];
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingClients, setSyncingClients] = useState(false);
  const [sheetSyncResult, setSheetSyncResult] = useState<ClientSheetSyncResult | null>(null);
  const [showSheetSyncResult, setShowSheetSyncResult] = useState(false);
  const [lastSync, setLastSync] = useState<PaymentSyncRun | null>(null);
  const columns = useColumnVisibility(clientColumns);
  const widths = useColumnWidths(clientColumns);
  const sorting = useTableSort();

  async function loadLastSync() {
    const response = await fetch("/api/audit-events?entityType=payment_sync&limit=1");
    const data = await response.json();
    // setState here only runs after the await above resolves — not a
    // synchronous effect update (react-hooks/set-state-in-effect).
    setLastSync(response.ok ? data.events?.[0] ?? null : null);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadLastSync only calls setState after its internal await resolves.
    loadLastSync();
  }, []);


  const activeSubscriptionByCustomer = useMemo(() => {
    const map = new Map<string, Subscription>();
    for (const subscription of subscriptions) {
      if (subscription.status !== "ACTIVE") continue;
      if (!map.has(subscription.customer_id)) map.set(subscription.customer_id, subscription);
    }
    return map;
  }, [subscriptions]);

  const linkedByCustomer = useMemo(() => {
    const map = new Map<string, Subscription[]>();
    for (const subscription of currentLinkedSubscriptions(subscriptions)) {
      const list = map.get(subscription.customer_id) ?? [];
      list.push(subscription);
      map.set(subscription.customer_id, list);
    }
    return map;
  }, [subscriptions]);
  const displayedSubscriptionByCustomer = useMemo(() => new Map([...linkedByCustomer].map(([id, list]) => [id, list[0]])), [linkedByCustomer]);

  // `activeCustomizations` scans the *entire* `events` array — fine for one
  // subscription, but the clients table calls it once per *visible row*
  // (hundreds), so doing that inline in JSX meant redoing that full scan,
  // for every row, on every render (every keystroke in search, every column
  // resize...). Precomputed once per actual data change instead.
  const customizationsByCustomer = useMemo(() => {
    const map = new Map<string, ActiveCustomization[]>();
    for (const [customerId, subscription] of activeSubscriptionByCustomer) {
      map.set(customerId, activeCustomizations(subscription.id, customerId, events));
    }
    return map;
  }, [activeSubscriptionByCustomer, events]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.filter((customer) => {
      if (statusFilter === "UNSET" ? customer.status !== null : statusFilter !== "all" && customer.status !== statusFilter) return false;
      if (actorFilter !== "all" && !(linkedByCustomer.get(customer.id) ?? []).some(s => s.display_actor_id === actorFilter)) return false;
      if (!term) return true;
      return [customer.office_name, customer.responsible_name, customer.email].some((field) => field?.toLowerCase().includes(term));
    });
  }, [customers, search, statusFilter, actorFilter, linkedByCustomer]);

  async function syncAllPayments() {
    setSyncingAll(true);
    try {
      const response = await fetch("/api/asaas/sync-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível sincronizar."); return; }
      const errorCount = data.errors?.length ?? 0;
      if (errorCount > 0) {
        toast.warning(`${data.payments} pagamento(s) sincronizado(s) de ${data.links} link(s), mas ${errorCount} link(s) falharam — clique em "Sincronizar pagamentos" novamente para tentar só esses.`);
      } else {
        toast.success(`${data.payments} pagamento(s) sincronizado(s) de ${data.links} link(s).`);
      }
      onChanged();
    } finally {
      setSyncingAll(false);
      await loadLastSync();
    }
  }

  async function syncClients() {
    setSyncingClients(true);
    try {
      const response = await fetch("/api/customers/sync-sheet", { method: "POST" });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível sincronizar a Base de Clientes."); return; }
      const result = data as ClientSheetSyncResult;
      setSheetSyncResult(result);
      setShowSheetSyncResult(true);
      const pending = result.systemOnlyEmails.length + result.skippedWithoutSignedAt.length + result.duplicateOfficeIds.length + result.officeIdConflicts.length + result.unresolvedRows.length;
      if (pending) toast.warning(`Base atualizada com ${pending} pendência(s) para revisar.`);
      else toast.success(`Base atualizada: ${result.created} cliente(s) incluído(s) e ${result.updated} atualizado(s).`);
      onChanged();
    } finally {
      setSyncingClients(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-border p-5">
          <div>
            <h2 className="font-semibold">Carteira de clientes</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">Novos clientes só entram se já constarem na aba ⭐ Base de Clientes do Google Sheets</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" disabled={syncingClients} onClick={syncClients}>{syncingClients ? "Atualizando clientes…" : "Sincronizar Base de Clientes"}</Button>
              <Button variant="outline" size="sm" disabled={syncingAll} onClick={syncAllPayments}>{syncingAll ? "Sincronizando…" : "Sincronizar pagamentos"}</Button>
            </div>
            {lastSync && (
              lastSync.action === "FAILED" ? (
                <p className="text-xs text-red-600 dark:text-red-300" title={lastSync.after_json?.error ?? ""}>Última sincronização falhou em {fmtDateTime(lastSync.created_at)}</p>
              ) : (
                <p className="text-xs text-slate-500 dark:text-muted-foreground">
                  Última sincronização: {fmtDateTime(lastSync.created_at)} · {lastSync.after_json?.payments ?? 0} pagamento(s)
                  {lastSync.after_json?.errors && lastSync.after_json.errors.length > 0 && (
                    <span className="text-amber-600 dark:text-amber-300" title={lastSync.after_json.errors.map((error) => error.message).join("\n")}> · {lastSync.after_json.errors.length} link(s) falharam</span>
                  )}
                </p>
              )
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-border p-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
            <Input className="pl-9" placeholder="Buscar por escritório, responsável ou e-mail" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="UNSET">Sem status</SelectItem>
              <SelectItem value="ACTIVE">Ativo</SelectItem>
              <SelectItem value="CANCELLED">Cancelado</SelectItem>
              <SelectItem value="FROZEN">Congelado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={actorFilter} onValueChange={setActorFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Parceiro" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os parceiros</SelectItem>
              {actors.map((actor) => <SelectItem key={actor.id} value={actor.id}>{actor.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <ColumnVisibilityMenu defs={clientColumns} isVisible={columns.isVisible} toggle={columns.toggle} />
        </div>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <ResizableTh {...sorting.header("client")} width={widths.getWidth("client", 220)} onResizeStart={widths.startResize("client", 220)}>Cliente</ResizableTh>
              {columns.isVisible("status") && <ResizableTh {...sorting.header("status")} width={widths.getWidth("status")} onResizeStart={widths.startResize("status")}>Status</ResizableTh>}
              {columns.isVisible("plan") && <ResizableTh {...sorting.header("plan")} width={widths.getWidth("plan")} onResizeStart={widths.startResize("plan")}>Plano</ResizableTh>}
              {columns.isVisible("mrr") && <ResizableTh {...sorting.header("mrr")} width={widths.getWidth("mrr")} onResizeStart={widths.startResize("mrr")} className="text-right">MRR</ResizableTh>}
              {columns.isVisible("actor") && <ResizableTh {...sorting.header("actor")} width={widths.getWidth("actor")} onResizeStart={widths.startResize("actor")}>Parceiro</ResizableTh>}
              {columns.isVisible("signedAt") && <ResizableTh {...sorting.header("signedAt")} width={widths.getWidth("signedAt")} onResizeStart={widths.startResize("signedAt")}>Assinado em</ResizableTh>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={columns.visibleCount + 1} className="text-center text-sm text-slate-500 dark:text-muted-foreground">Nenhum cliente encontrado.</TableCell></TableRow>}
            {sorting.rows(filtered, customer => { return { client: customer.office_name, status: statusLabelOrUnset(customer.status), plan: (linkedByCustomer.get(customer.id) ?? []).map(s => s.display_plan_name).join(", "), mrr: activeSubscriptionByCustomer.get(customer.id) ? monthlyValue(activeSubscriptionByCustomer.get(customer.id)!.value, activeSubscriptionByCustomer.get(customer.id)!.billing_period) : null, actor: (linkedByCustomer.get(customer.id) ?? []).map(s => s.display_actor_label ?? "Sem responsável comercial").join(" · "), signedAt: customer.signed_at }; }).map((customer) => {
              const subscription = displayedSubscriptionByCustomer.get(customer.id);
              const active = activeSubscriptionByCustomer.get(customer.id);
              const mrr = active ? monthlyValue(active.value, active.billing_period) : 0;
              return (
                <TableRow key={customer.id} onClick={() => setSelectedId(customer.id)} className={`cursor-pointer ${selectedId === customer.id ? "bg-[#eaf1fc]" : ""}`}>
                  <TableCell>
                    <button className="font-medium text-left hover:underline" aria-haspopup="dialog" onClick={() => setSelectedId(customer.id)}>{customer.office_name}</button>
                    <p className="text-xs text-slate-500 dark:text-muted-foreground">{customer.responsible_name ?? customer.email ?? "—"}</p>
                  </TableCell>
                  {columns.isVisible("status") && <TableCell><Badge variant="outline" className={statusBadgeClassOrUnset(customer.status)}>{statusLabelOrUnset(customer.status)}</Badge></TableCell>}
                  {columns.isVisible("plan") && <TableCell className="text-sm text-slate-600 dark:text-muted-foreground"><span className="inline-flex items-center gap-1">{(linkedByCustomer.get(customer.id) ?? []).map(s => s.display_plan_name).join(" · ") || "—"}{(linkedByCustomer.get(customer.id)?.length ?? 0) > 1 && <Badge variant="outline" className="text-amber-700 dark:text-amber-300">Revisar planos</Badge>}{subscription && <CustomizationHint items={customizationsByCustomer.get(customer.id) ?? []} />}</span></TableCell>}
                  {columns.isVisible("mrr") && <TableCell className="text-right text-sm font-medium">{mrr > 0 ? money.format(mrr) : "—"}</TableCell>}
                  {columns.isVisible("actor") && <TableCell className="text-sm text-slate-600 dark:text-muted-foreground">{(linkedByCustomer.get(customer.id) ?? []).map(s => s.display_actor_label ?? "Sem responsável comercial").join(" · ") || "—"}</TableCell>}
                  {columns.isVisible("signedAt") && <TableCell className="text-sm text-slate-500 dark:text-muted-foreground">{fmtDate(customer.signed_at)}</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      <Dialog open={showSheetSyncResult} onOpenChange={setShowSheetSyncResult}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resultado da Base de Clientes</DialogTitle>
            <DialogDescription>Os cadastros foram reconciliados por e-mail. Status, planos, pagamentos e históricos foram preservados.</DialogDescription>
          </DialogHeader>
          {sheetSyncResult && <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/40"><p className="text-xs text-emerald-700 dark:text-emerald-300">Incluídos</p><p className="mt-1 text-xl font-semibold">{sheetSyncResult.created}</p></div>
              <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-950/40"><p className="text-xs text-blue-700 dark:text-blue-300">Atualizados</p><p className="mt-1 text-xl font-semibold">{sheetSyncResult.updated}</p></div>
              <div className="rounded-xl bg-violet-50 p-3 dark:bg-violet-950/40"><p className="text-xs text-violet-700 dark:text-violet-300">Duplicados consolidados</p><p className="mt-1 text-xl font-semibold">{sheetSyncResult.consolidated}</p></div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-muted"><p className="text-xs text-slate-500 dark:text-muted-foreground">Sem alteração</p><p className="mt-1 text-xl font-semibold">{sheetSyncResult.unchanged}</p></div>
            </div>
            {sheetSyncResult.consolidatedEmails.length > 0 && <p className="rounded-xl bg-violet-50 p-3 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">Cadastros antigos consolidados com todos os vínculos preservados: {sheetSyncResult.consolidatedEmails.join(", ")}.</p>}
            {sheetSyncResult.systemOnlyEmails.length > 0 && <SyncIssue title={`No sistema, mas fora da Base de Clientes (${sheetSyncResult.systemOnlyEmails.length})`} items={sheetSyncResult.systemOnlyEmails} />}
            {sheetSyncResult.skippedWithoutSignedAt.length > 0 && <SyncIssue title={`Sem data “Assinado em” (${sheetSyncResult.skippedWithoutSignedAt.length})`} items={sheetSyncResult.skippedWithoutSignedAt} tone="danger" />}
            {sheetSyncResult.duplicateSheetEmails.length > 0 && <SyncIssue title="E-mails compartilhados na Base — clientes mantidos separados" items={sheetSyncResult.duplicateSheetEmails} />}
            {sheetSyncResult.duplicateSystemEmails.length > 0 && <SyncIssue title="E-mails compartilhados no sistema — cadastros mantidos separados" items={sheetSyncResult.duplicateSystemEmails} />}
            {sheetSyncResult.duplicateOfficeIds.length > 0 && <SyncIssue title="Números de cliente repetidos na Base" items={sheetSyncResult.duplicateOfficeIds} tone="danger" />}
            {sheetSyncResult.officeIdConflicts.length > 0 && <SyncIssue title="Conflitos no número do cliente" items={sheetSyncResult.officeIdConflicts} tone="danger" />}
            {sheetSyncResult.unresolvedRows.length > 0 && <SyncIssue title="Linhas que ainda não podem ser separadas" items={sheetSyncResult.unresolvedRows} tone="danger" />}
            {sheetSyncResult.ignoredWithoutEmail > 0 && <p className="rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{sheetSyncResult.ignoredWithoutEmail} linha(s) sem e-mail foram ignoradas.</p>}
          </div>}
        </DialogContent>
      </Dialog>
      <ClientDialog customerId={selectedId} customers={customers} subscriptions={subscriptions} payments={payments} implementationPayments={implementationPayments} plans={plans} actors={actors} links={links} events={events} onChanged={onChanged} onOpenChange={open => { if (!open) setSelectedId(null); }} />
    </div>
  );
}

function SyncIssue({ title, items, tone = "warning" }: { title: string; items: string[]; tone?: "warning" | "danger" }) {
  return <div className={`rounded-xl p-3 ${tone === "danger" ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"}`}>
    <p className="font-medium">{title}</p>
    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">{items.map(item => <li key={item}>{item}</li>)}</ul>
  </div>;
}

export function ClientDialog({ customerId, customers, subscriptions, payments, implementationPayments, plans, actors, links, events, onChanged, onOpenChange }: {
  customerId: string | null;
  customers: Customer[];
  subscriptions: Subscription[];
  payments: Payment[];
  implementationPayments: ImplementationPayment[];
  plans: Plan[];
  actors: CommercialActor[];
  links: PaymentLink[];
  events: CustomerActivity[];
  onChanged: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const customer = customers.find(candidate => candidate.id === customerId) ?? null;
  return <Dialog open={Boolean(customer)} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader><DialogTitle>{customer?.office_name ?? "Cliente"}</DialogTitle><DialogDescription>Acompanhamento, assinaturas, pagamentos e cadastro.</DialogDescription></DialogHeader>
      {customer && <ClientDetail
        key={customer.id}
        customer={customer}
        subscriptions={subscriptions.filter(subscription => subscription.customer_id === customer.id)}
        payments={payments.filter(payment => payment.customer_id === customer.id)}
        implementationPayments={implementationPayments.filter(payment => payment.customer_id === customer.id)}
        plans={plans}
        actors={actors}
        links={links}
        events={events.filter(event => event.customerId === customer.id)}
        onChanged={onChanged}
      />}
    </DialogContent>
  </Dialog>;
}

function ClientDetail({ customer, subscriptions, payments, implementationPayments, plans, actors, events, onChanged }: {
  customer: Customer;
  subscriptions: Subscription[];
  payments: Payment[];
  implementationPayments: ImplementationPayment[];
  plans: Plan[];
  actors: CommercialActor[];
  links: PaymentLink[];
  events: CustomerActivity[];
  onChanged: () => void;
}) {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const [status, setStatus] = useState<Customer["status"]>(customer.status);
  const [cancellationCategory, setCancellationCategory] = useState(customer.cancellation_category ?? "");
  const [cancellationReason, setCancellationReason] = useState(customer.cancellation_reason ?? "");
  const [comments, setComments] = useState(customer.comments ?? "");
  const [acquisitionActorId, setAcquisitionActorId] = useState<string>(customer.acquisition_actor_id ?? "none");
  const [saving, setSaving] = useState(false);
  const [addingPlan, setAddingPlan] = useState(false);
  const [addingImplementationPayment, setAddingImplementationPayment] = useState(false);
  const implementationPlans = plans.filter((plan) => (plan.kind === "IMPLEMENTATION" || plan.kind === "CONSULTING") && plan.status === "ACTIVE");

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: customer.id,
          status,
          cancellationCategory: cancellationCategory || null,
          cancellationReason: cancellationReason || null,
          comments: comments || null,
          acquisitionActorId: acquisitionActorId === "none" ? null : acquisitionActorId,
        }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível salvar."); return; }
      toast.success("Cliente atualizado.");
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#3b82f6]">Cliente selecionado</p>
        <h2 className="mt-2 text-lg font-semibold">{customer.office_name}</h2>
        <p className="text-sm text-slate-500 dark:text-muted-foreground">{customer.responsible_name ?? "—"} · {customer.email ?? "sem e-mail"}</p>
        {(customer.city || customer.state) && <p className="text-xs text-slate-400">{[customer.city, customer.state].filter(Boolean).join(" - ")}</p>}
      </div>

      {currentLinkedSubscriptions(subscriptions).length > 1 && <div role="alert" className="rounded-xl bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"><p className="font-medium">Este cliente possui mais de um plano vinculado em uso.</p><p className="mt-1">Confira as assinaturas abaixo e desative o plano que não deve permanecer no painel. Essa ação mantém o histórico e não cancela cobranças no Asaas.</p></div>}
      <CustomerTimeline subscriptions={subscriptions} customerId={customer.id} events={events} onChanged={onChanged} />
      <div className="space-y-2 rounded-xl border border-slate-200 dark:border-border p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-muted-foreground">Assinaturas</p>
          <Button variant="outline" size="sm" onClick={() => setAddingPlan((current) => !current)}>{addingPlan ? "Cancelar" : "+ Cadastrar plano"}</Button>
        </div>
        {subscriptions.length === 0 && !addingPlan && <p className="text-sm text-slate-500 dark:text-muted-foreground">Nenhuma assinatura registrada. Se este cliente é cobrado fora do Asaas (ex: veio da planilha e ainda não pagou por link), cadastre o plano manualmente para que ele entre no MRR.</p>}
        {addingPlan && <ManualSubscriptionForm customerId={customer.id} onDone={() => { setAddingPlan(false); onChanged(); }} onCancel={() => setAddingPlan(false)} />}
        {subscriptions.map((subscription) => (
          <SubscriptionRow key={subscription.id} subscription={subscription} customizations={activeCustomizations(subscription.id, customer.id, events)} onChanged={onChanged} />
        ))}
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 dark:border-border p-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-muted-foreground">Pagamentos ({payments.length})</p>
        {payments.length === 0 && <p className="text-sm text-slate-500 dark:text-muted-foreground">Nenhum pagamento registrado ainda.</p>}
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {payments.slice(0, 20).map((payment) => (
            <div key={payment.id} className="flex items-center justify-between gap-2 text-sm">
              <span className={isPaidStatus(payment.status) ? "text-emerald-700 dark:text-emerald-300" : "text-slate-500 dark:text-muted-foreground"}>{payment.status}</span>
              <PaymentDates payment={payment} />
              <span className="font-medium">{money.format(payment.value)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50/30 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">Implantações ({implementationPayments.length})</p>
          <Button variant="outline" size="sm" onClick={() => setAddingImplementationPayment((current) => !current)}>{addingImplementationPayment ? "Cancelar" : "+ Registrar pagamento"}</Button>
        </div>
        {implementationPayments.length === 0 && !addingImplementationPayment && <p className="text-sm text-slate-500 dark:text-muted-foreground">Nenhuma taxa de implantação/consultoria registrada para este cliente. Se o cliente pagou fora do Asaas (transferência, dinheiro etc.), registre manualmente.</p>}
        {addingImplementationPayment && (
          <ManualImplementationPaymentForm
            customerId={customer.id}
            plans={implementationPlans}
            actors={actors}
            onDone={() => { setAddingImplementationPayment(false); onChanged(); }}
            onCancel={() => setAddingImplementationPayment(false)}
          />
        )}
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {implementationPayments.slice(0, 20).map((payment) => {
            const plan = payment.plan_id ? planById.get(payment.plan_id) : undefined;
            return (
            <div key={payment.id} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className={isPaidStatus(payment.status) ? "text-emerald-700 dark:text-emerald-300" : "text-slate-500 dark:text-muted-foreground"}>{payment.status}</span>
                <PaymentDates payment={payment} />
                <span className="font-medium">{money.format(payment.value)}</span>
              </div>
              <p className="flex items-center gap-1.5 truncate text-xs text-slate-500 dark:text-muted-foreground" title={payment.description}>
                {plan && <Badge variant="outline" className={`shrink-0 text-[10px] ${planBadgeClass(plan)}`}>{planKindLabels[plan.kind]}</Badge>}
                {payment.source === "MANUAL" && <Badge variant="outline" className="shrink-0 text-[10px] border-slate-200 dark:border-border bg-slate-50 dark:bg-muted text-slate-500 dark:text-muted-foreground">Manual</Badge>}
                <span className="truncate">{payment.description}</span>
              </p>
            </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-dashed border-slate-200 dark:border-border p-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-muted-foreground">Editar cadastro</p>
        <Select value={status ?? "UNSET"} onValueChange={(value) => setStatus(value as ConfirmedStatus)}>
          <SelectTrigger className="w-full"><SelectValue>{statusLabelOrUnset(status)}</SelectValue></SelectTrigger>
          <SelectContent>
            {!status && <SelectItem value="UNSET" disabled>Sem status</SelectItem>}
            <SelectItem value="ACTIVE">Ativo</SelectItem>
            <SelectItem value="CANCELLED">Cancelado</SelectItem>
            <SelectItem value="FROZEN">Congelado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={acquisitionActorId} onValueChange={setAcquisitionActorId}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Parceiro de origem" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Orgânico / sem parceiro</SelectItem>
            {actors.map((actor) => <SelectItem key={actor.id} value={actor.id}>{actor.name} · {roleLabels[actor.role]}</SelectItem>)}
          </SelectContent>
        </Select>
        {status === "CANCELLED" && (
          <>
            <Input placeholder="Categoria do cancelamento" value={cancellationCategory} onChange={(event) => setCancellationCategory(event.target.value)} />
            <Textarea placeholder="Motivo do cancelamento" value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} />
          </>
        )}
        <Textarea placeholder="Comentários internos (CS)" value={comments} onChange={(event) => setComments(event.target.value)} />
        <Button className="w-full bg-[#3a5d9d] text-white hover:bg-[#2c4a80]" disabled={saving} onClick={save}>{saving ? "Salvando…" : "Salvar alterações"}</Button>
      </div>
    </div>
  );
}

/** One subscription card with an inline, auto-saving status editor — lets the operator manually confirm ACTIVE/FROZEN/CANCELLED for subscriptions that came out of the Set/2026 reset with no status at all. */
function SubscriptionRow({ subscription, customizations, onChanged }: { subscription: Subscription; customizations: ActiveCustomization[]; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  async function setStatus(status: "ACTIVE" | "FROZEN" | "CANCELLED") {
    if (saving || status === subscription.status) return;
    setSaving(true);
    try {
      const response = await fetch("/api/subscriptions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: subscription.id, status }) });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível atualizar o status."); return; }
      toast.success("Status da assinatura atualizado.");
      onChanged();
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="rounded-lg border border-slate-100 dark:border-border p-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 font-medium">{subscription.display_plan_name ?? "—"}<CustomizationHint items={customizations} /></span>
        <Select disabled={saving} value={subscription.status ?? "UNSET"} onValueChange={(value) => setStatus(value as "ACTIVE" | "FROZEN" | "CANCELLED")}>
          <SelectTrigger className={"h-7 w-auto gap-1.5 border px-2 text-xs " + statusBadgeClassOrUnset(subscription.status)}><SelectValue>{statusLabelOrUnset(subscription.status)}</SelectValue></SelectTrigger>
          <SelectContent>
            {!subscription.status && <SelectItem value="UNSET" disabled>Sem status</SelectItem>}
            <SelectItem value="ACTIVE">Ativo</SelectItem>
            <SelectItem value="FROZEN">Congelado</SelectItem>
            <SelectItem value="CANCELLED">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {subscription.status !== "CANCELLED" && <Button variant="ghost" size="sm" disabled={saving} onClick={() => setStatus("CANCELLED")}>Desativar no painel</Button>}
      <p className="text-xs text-slate-500 dark:text-muted-foreground">{subscription.billing_period === "ANNUAL" ? "Anual" : "Mensal"} · {money.format(subscription.value)}{subscription.source === "LEGACY_IMPORT" ? " · importado" : subscription.source === "MANUAL" ? " · cadastrado manualmente" : ""}</p>
      {subscription.display_actor_label ? (
        <p className="mt-1 text-xs font-medium text-[#3b82f6]">{subscription.display_actor_label}</p>
      ) : (
        <p className="mt-1 text-xs text-slate-400">{subscription.payment_link_id ? "Sem responsável comercial vinculado" : subscription.source === "MANUAL" ? "Cadastro manual" : "Venda direta / legado"}</p>
      )}
    </div>
  );
}

function ManualSubscriptionForm({ customerId, onDone, onCancel }: { customerId: string; onDone: () => void; onCancel: () => void }) {
  const [planName, setPlanName] = useState("");
  const [billingPeriod, setBillingPeriod] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [value, setValue] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [startedAt, setStartedAt] = useState(localDate);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, planName, billingPeriod, value: Number(value), paymentMethod: paymentMethod || null, startedAt }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível cadastrar o plano."); return; }
      toast.success("Plano cadastrado. O MRR já considera esse valor.");
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-[#3b82f6] bg-blue-50/30 p-3">
      <p className="text-xs text-slate-500 dark:text-muted-foreground">Use isto para clientes cobrados fora do Asaas (ex: entrou pela planilha e ainda não tem link de pagamento). Isso não gera cobrança nenhuma, só registra o plano para as métricas.</p>
      <Input placeholder="Nome do plano" value={planName} onChange={(event) => setPlanName(event.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Select value={billingPeriod} onValueChange={(period) => setBillingPeriod(period as "MONTHLY" | "ANNUAL")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="MONTHLY">Mensal</SelectItem>
            <SelectItem value="ANNUAL">Anual</SelectItem>
          </SelectContent>
        </Select>
        <Input type="number" min="0.01" step="0.01" placeholder={`Valor integral ${billingPeriod === "ANNUAL" ? "anual" : "mensal"} (R$)`} value={value} onChange={(event) => setValue(event.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Forma de pagamento (opcional)" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} />
        <Input type="date" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" className="flex-1 bg-[#3a5d9d] text-white hover:bg-[#2c4a80]" disabled={saving || !planName.trim() || !(Number(value) > 0)} onClick={save}>{saving ? "Salvando…" : "Salvar plano"}</Button>
      </div>
    </div>
  );
}

/** Registers an implantação/consultoria payment that happened outside the Asaas link flow (ex: cliente pagou uma consultoria por transferência). Mirrors `ManualSubscriptionForm`'s "cobrado fora do Asaas" pattern, but writes to `implementation_payments` instead — never touches MRR/subscriptions. */
function ManualImplementationPaymentForm({ customerId, plans, actors, onDone, onCancel }: { customerId: string; plans: Plan[]; actors: CommercialActor[]; onDone: () => void; onCancel: () => void }) {
  const [planId, setPlanId] = useState("none");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [billingType, setBillingType] = useState("");
  const [actorId, setActorId] = useState("none");
  const [paymentDate, setPaymentDate] = useState(localDate);
  const [saving, setSaving] = useState(false);

  function onPlanChange(id: string) {
    setPlanId(id);
    if (id === "none") return;
    const plan = plans.find((candidate) => candidate.id === id);
    if (plan && !description.trim()) setDescription(plan.name);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/implementation-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          planId: planId === "none" ? null : planId,
          actorId: actorId === "none" ? null : actorId,
          description,
          value: Number(value),
          billingType: billingType || null,
          paymentDate,
        }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível registrar o pagamento."); return; }
      toast.success("Pagamento registrado.");
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-violet-400 bg-violet-50/50 p-3">
      <p className="text-xs text-slate-500 dark:text-muted-foreground">Use isto para uma implantação ou consultoria paga fora do Asaas (transferência, dinheiro etc.). Não gera cobrança nenhuma, só registra o recebimento — nunca entra no MRR/assinaturas.</p>
      <Select value={planId} onValueChange={onPlanChange}>
        <SelectTrigger className="w-full"><SelectValue placeholder="Plano (opcional)" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sem plano do catálogo</SelectItem>
          {plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input placeholder="Descrição" value={description} onChange={(event) => setDescription(event.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Input type="number" min="0.01" step="0.01" placeholder="Valor pago (R$)" value={value} onChange={(event) => setValue(event.target.value)} />
        <Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Forma de pagamento (opcional)" value={billingType} onChange={(event) => setBillingType(event.target.value)} />
        <Select value={actorId} onValueChange={setActorId}>
          <SelectTrigger><SelectValue placeholder="Parceiro (opcional)" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem parceiro</SelectItem>
            {actors.map((actor) => <SelectItem key={actor.id} value={actor.id}>{actor.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" className="flex-1 bg-[#3a5d9d] text-white hover:bg-[#2c4a80]" disabled={saving || !description.trim() || !(Number(value) > 0)} onClick={save}>{saving ? "Salvando…" : "Salvar pagamento"}</Button>
      </div>
    </div>
  );
}
