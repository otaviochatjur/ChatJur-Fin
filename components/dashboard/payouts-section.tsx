"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown, History, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ColumnVisibilityMenu, ResizableTh, useTableSort, useColumnVisibility, useColumnWidths, type ColumnDef } from "@/components/dashboard/table-toolbar";
import { downloadBrandedPdf, downloadBrandedXlsx, seededRandom } from "@/lib/reports";
import {
  computeActorPayout,
  computeActorPayoutDetail,
  money,
  roleLabels,
  PAYOUT_ELIGIBLE_ROLES,
  type ActorPayout,
  type CommercialActor,
  type CommissionRate,
  type Customer,
  type Payment,
  type Subscription,
} from "@/lib/metrics";

const ROLE_TABS = PAYOUT_ELIGIBLE_ROLES;

const payoutStatusFilters = ["ALL", "PENDING", "PAID"] as const;
const payoutStatusFilterLabels: Record<(typeof payoutStatusFilters)[number], string> = { ALL: "Todos", PENDING: "Pendentes", PAID: "Pagos" };

const payoutColumns: ColumnDef<"received" | "commission" | "status">[] = [
  { key: "received", label: "Recebido no período", defaultWidth: 170 },
  { key: "commission", label: "Comissão calculada", defaultWidth: 170 },
  { key: "status", label: "Status", defaultWidth: 220 },
];

const rolePluralLabels: Record<(typeof ROLE_TABS)[number], string> = {
  PARTNER: "Parceiros",
  AMBASSADOR: "Embaixadores",
  EXTERNAL_SALES: "Comerciais externos",
  INSTITUTIONAL: "Institucionais",
};

const bankAccountTypeLabels: Record<string, string> = { CORRENTE: "Corrente", POUPANCA: "Poupança" };

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  const label = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || "parceiro";
}

const DEMO_BANNER = "AMOSTRA — DADOS FICTÍCIOS, apenas para pré-visualizar o layout do relatório";
const DEMO_BANKS = ["Nubank", "Itaú Unibanco", "Banco do Brasil", "Bradesco", "Banco Inter", "Santander"];
const DEMO_OFFICES = ["Silva & Associados", "Almeida Advocacia", "Costa & Ferreira Advogados", "Barros Consultoria Jurídica", "Martins Sociedade de Advogados", "Rocha Advocacia Empresarial", "Pereira & Lima Advogados", "Nunes Advocacia Trabalhista"];
const DEMO_PLAN_NAMES = ["Plano Essencial", "Plano Profissional", "Plano Escritório", "Plano Corporativo"];

/**
 * "Dados fictícios" builders for the report demo mode — deterministic per
 * actor (via `seededRandom`) so the numbers stay stable across repeated
 * exports, but never touch Supabase: they only exist inside the generated
 * PDF/Excel, letting the user preview the report layout/branding before
 * every real cadastro has banking data or commission rates filled in.
 */
function buildDemoAccountingRow(actor: CommercialActor) {
  const rand = seededRandom(`accounting-${actor.id}`);
  const received = 800 + rand() * 4200;
  const ratePercent = Math.round((8 + rand() * 12) * 10) / 10;
  const commission = received * (ratePercent / 100);
  const paid = rand() > 0.45;
  return {
    received,
    commission,
    paid,
    paidAmount: paid ? commission * (0.92 + rand() * 0.16) : 0,
    paidAt: paid ? new Date(Date.now() - Math.floor(rand() * 20 + 1) * 86400000) : null,
    document: `${Math.floor(100 + rand() * 800)}.${Math.floor(100 + rand() * 800)}.${Math.floor(100 + rand() * 800)}-${Math.floor(10 + rand() * 89)}`,
    pix: `${slugify(actor.name)}@exemplo.com`,
    bank: DEMO_BANKS[Math.floor(rand() * DEMO_BANKS.length)],
    accountType: rand() > 0.5 ? "Corrente" : "Poupança",
    agency: String(1000 + Math.floor(rand() * 8999)),
    account: `${Math.floor(10000 + rand() * 89999)}-${Math.floor(rand() * 9)}`,
  };
}

function buildDemoPartnerItems(actor: CommercialActor) {
  const rand = seededRandom(`partner-${actor.id}`);
  const count = 2 + Math.floor(rand() * 4);
  return Array.from({ length: count }, () => {
    const isAnnual = rand() > 0.6;
    const subscriptionValue = isAnnual ? 3000 + rand() * 9000 : 250 + rand() * 900;
    const ratePercent = Math.round((8 + rand() * 12) * 10) / 10;
    const commissionBase = isAnnual ? subscriptionValue / 12 : subscriptionValue;
    return {
      customerName: DEMO_OFFICES[Math.floor(rand() * DEMO_OFFICES.length)],
      planName: DEMO_PLAN_NAMES[Math.floor(rand() * DEMO_PLAN_NAMES.length)],
      billingLabel: isAnnual ? "Anual" : "Mensal",
      subscriptionValue,
      commissionBase,
      ratePercent,
      commission: commissionBase * (ratePercent / 100),
      paymentDate: new Date(Date.now() - Math.floor(rand() * 25 + 1) * 86400000),
    };
  });
}

/**
 * "Repasses" tab: monthly commission owed to Parceiros/Embaixadores/
 * Comercial externo. Pending amounts are always computed live from real
 * (received) payments x each actor's per-plan commission rate — see
 * `computeActorPayout` in lib/metrics.ts — never pre-generated, so they
 * can't drift if a payment is later refunded. A row only lands in
 * `actor_payouts` once explicitly marked as paid, which is what gives us
 * the month-by-month paid history.
 *
 * The checkbox column feeds two branded (logo + Chat Jurídico colors)
 * exports, each in PDF or real .xlsx, chosen via the format selector: one
 * combined "para a contabilidade" report (every selected cadastro, whatever
 * category, with banking data) and one "por parceiro" report per selected
 * cadastro (with the underlying subscriptions) meant to be forwarded to
 * that person. Selection persists across role tabs so a single accounting
 * export can span Parceiros + Embaixadores + Comerciais externos at once.
 *
 * "Dados fictícios" toggle bypasses the checkbox selection and the real
 * computed numbers entirely, generating a demo report (clearly banner'd as
 * a sample) for every cadastro in the current tab — for previewing the
 * report's layout before every partner's banking/commission data is filled
 * in. It never writes anything to Supabase.
 */
export function PayoutsSection({ actors, subscriptions, payments, customers }: { actors: CommercialActor[]; subscriptions: Subscription[]; payments: Payment[]; customers: Customer[] }) {
  const [role, setRole] = useState<(typeof ROLE_TABS)[number]>("PARTNER");
  const [period, setPeriod] = useState(currentPeriod());
  const [rates, setRates] = useState<CommissionRate[]>([]);
  const [payouts, setPayouts] = useState<ActorPayout[]>([]);
  const [selectedActorIds, setSelectedActorIds] = useState<Set<string>>(new Set());
  const [payoutStatusFilter, setPayoutStatusFilter] = useState<(typeof payoutStatusFilters)[number]>("ALL");
  const [nameSearch, setNameSearch] = useState("");
  const columns = useColumnVisibility(payoutColumns);
  const widths = useColumnWidths(payoutColumns);
  const sorting = useTableSort();
  const [reportFormat, setReportFormat] = useState<"pdf" | "xlsx">("pdf");
  const [demoMode, setDemoMode] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [dialogActor, setDialogActor] = useState<CommercialActor | null>(null);
  const [dialogAmount, setDialogAmount] = useState("");
  const [dialogNotes, setDialogNotes] = useState("");
  const [dialogComputedAmount, setDialogComputedAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [historyActor, setHistoryActor] = useState<CommercialActor | null>(null);

  async function load() {
    const [ratesRes, payoutsRes] = await Promise.all([fetch("/api/commission-rates"), fetch("/api/payouts")]);
    const [ratesData, payoutsData] = await Promise.all([ratesRes.json(), payoutsRes.json()]);
    // setState here only runs after the awaits above resolve — not a
    // synchronous effect update (react-hooks/set-state-in-effect).
    setRates(ratesRes.ok ? ratesData.rates ?? [] : []);
    setPayouts(payoutsRes.ok ? payoutsData.payouts ?? [] : []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load only calls setState after its internal awaits resolve.
    load();
  }, []);

  const actorsForRole = useMemo(() => actors.filter((actor) => actor.role === role), [actors, role]);
  const referenceMonth = `${period}-01`;

  const rows = useMemo(() => actorsForRole.map((actor) => {
    const computed = computeActorPayout(actor.id, period, subscriptions, payments, rates);
    const paidRecord = payouts.find((payout) => payout.actor_id === actor.id && payout.reference_month === referenceMonth) ?? null;
    return { actor, computed, paidRecord };
  }), [actorsForRole, period, subscriptions, payments, rates, payouts, referenceMonth]);

  const totalComputed = rows.reduce((sum, row) => sum + row.computed.commission, 0);
  const totalPaid = rows.reduce((sum, row) => sum + (row.paidRecord ? row.paidRecord.amount : 0), 0);
  const pendingCount = rows.filter((row) => !row.paidRecord && row.computed.commission > 0).length;

  const nameTerm = nameSearch.trim().toLowerCase();
  const visibleRows = rows
    .filter((row) => payoutStatusFilter === "ALL" || (payoutStatusFilter === "PAID" ? row.paidRecord !== null : row.paidRecord === null))
    .filter((row) => !nameTerm || row.actor.name.toLowerCase().includes(nameTerm));

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selectedActorIds.has(row.actor.id));

  function toggleActorSelected(actorId: string, checked: boolean) {
    setSelectedActorIds((current) => {
      const next = new Set(current);
      if (checked) next.add(actorId); else next.delete(actorId);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedActorIds((current) => {
      const next = new Set(current);
      for (const row of visibleRows) { if (allVisibleSelected) next.delete(row.actor.id); else next.add(row.actor.id); }
      return next;
    });
  }

  function openMarkPaid(actor: CommercialActor, computedAmount: number, existing: ActorPayout | null) {
    setDialogActor(actor);
    setDialogComputedAmount(computedAmount);
    setDialogAmount((existing ? existing.amount : computedAmount).toFixed(2));
    setDialogNotes(existing?.notes ?? "");
  }

  async function confirmMarkPaid() {
    if (!dialogActor) return;
    const amount = Number(dialogAmount);
    if (!Number.isFinite(amount) || amount < 0) { toast.error("Informe um valor válido."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: dialogActor.id, period, amount, computedAmount: dialogComputedAmount, notes: dialogNotes }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível registrar o repasse."); return; }
      toast.success(`Repasse de ${dialogActor.name} marcado como pago.`);
      setDialogActor(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function undoPaid(payout: ActorPayout, actorName: string) {
    const response = await fetch(`/api/payouts?id=${payout.id}`, { method: "DELETE" });
    if (!response.ok) { toast.error("Não foi possível desfazer."); return; }
    toast.success(`Repasse de ${actorName} voltou para pendente.`);
    await load();
  }

  async function exportAccountingReport() {
    const targets = demoMode ? actorsForRole : actors.filter((actor) => selectedActorIds.has(actor.id));
    if (targets.length === 0) {
      toast.error(demoMode ? `Nenhum cadastro em ${rolePluralLabels[role].toLowerCase()} para gerar o exemplo.` : "Marque ao menos um cadastro na tabela para gerar o relatório.");
      return;
    }

    const columns = ["Nome", "Categoria", "Documento", "Pix", "Banco", "Tipo de conta", "Agência", "Conta", "Recebido no período", "Comissão calculada", "Status", "Valor pago", "Data do pagamento", "Observações bancárias"];
    const dataRows: (string | number)[][] = [];
    let totalCommission = 0;
    let totalPaid = 0;

    for (const actor of targets) {
      if (demoMode) {
        const demo = buildDemoAccountingRow(actor);
        totalCommission += demo.commission;
        totalPaid += demo.paidAmount;
        dataRows.push([
          actor.name, roleLabels[actor.role], demo.document, demo.pix, demo.bank, demo.accountType, demo.agency, demo.account,
          money.format(demo.received), money.format(demo.commission), demo.paid ? "Pago" : "Pendente",
          demo.paid ? money.format(demo.paidAmount) : "", demo.paidAt ? demo.paidAt.toLocaleDateString("pt-BR") : "",
          "Dados fictícios — cadastro real ainda não preenchido",
        ]);
      } else {
        const computed = computeActorPayout(actor.id, period, subscriptions, payments, rates);
        const paid = payouts.find((payout) => payout.actor_id === actor.id && payout.reference_month === referenceMonth) ?? null;
        totalCommission += computed.commission;
        totalPaid += paid ? paid.amount : 0;
        dataRows.push([
          actor.name, roleLabels[actor.role], actor.document ?? "", actor.pix_key ?? "", actor.bank_name ?? "",
          actor.bank_account_type ? bankAccountTypeLabels[actor.bank_account_type] : "", actor.bank_agency ?? "", actor.bank_account ?? "",
          money.format(computed.grossReceived), money.format(computed.commission), paid ? "Pago" : "Pendente",
          paid ? money.format(paid.amount) : "", paid ? new Date(paid.paid_at).toLocaleDateString("pt-BR") : "", actor.bank_notes ?? "",
        ]);
      }
    }

    const totalsRow = ["Total", "", "", "", "", "", "", "", "", money.format(totalCommission), "", money.format(totalPaid), "", ""];
    const subtitle = `${periodLabel(period)} · ${targets.length} cadastro(s)${demoMode ? ` · ${rolePluralLabels[role]}` : ""}`;
    const footNote = "Anual: comissão = 1/12 do valor do plano por mês ativo do ciclo, independente do número de parcelas escolhido pelo cliente. Mensal: comissão só no mês em que o pagamento é confirmado.";
    const filenameBase = `repasses-contabilidade-${period}${demoMode ? "-exemplo" : ""}`;

    setExporting(true);
    try {
      if (reportFormat === "pdf") {
        await downloadBrandedPdf({
          title: "Relatório de Repasses — Contabilidade",
          subtitle,
          banner: demoMode ? DEMO_BANNER : undefined,
          columns,
          rows: dataRows,
          rightAlignColumns: [8, 9, 11],
          totalsRow,
          footNote,
          filename: `${filenameBase}.pdf`,
        });
      } else {
        downloadBrandedXlsx(`${filenameBase}.xlsx`, [{ name: "Contabilidade", title: "Chat Jurídico — Relatório de Repasses (Contabilidade)", subtitle, columns, rows: dataRows, totalsRow }]);
      }
      toast.success(`Relatório gerado com ${targets.length} cadastro(s)${demoMode ? " (dados fictícios)" : ""}.`);
    } finally {
      setExporting(false);
    }
  }

  async function exportPartnerReports() {
    const targets = demoMode ? actorsForRole : actors.filter((actor) => selectedActorIds.has(actor.id));
    if (targets.length === 0) {
      toast.error(demoMode ? `Nenhum cadastro em ${rolePluralLabels[role].toLowerCase()} para gerar o exemplo.` : "Marque ao menos um cadastro na tabela para gerar o relatório.");
      return;
    }

    setExporting(true);
    try {
      const columns = ["Cliente", "Plano", "Cobrança", "Valor da assinatura", "MRR considerado", "Taxa aplicada", "Comissão gerada", "Pagamento confirmado em"];
      for (let index = 0; index < targets.length; index += 1) {
        const actor = targets[index];
        const dataRows: (string | number)[][] = [];
        let totalCommission = 0;

        if (demoMode) {
          for (const item of buildDemoPartnerItems(actor)) {
            totalCommission += item.commission;
            dataRows.push([item.customerName, item.planName, item.billingLabel, money.format(item.subscriptionValue), money.format(item.commissionBase), `${item.ratePercent}%`, money.format(item.commission), item.paymentDate.toLocaleDateString("pt-BR")]);
          }
        } else {
          const items = computeActorPayoutDetail(actor.id, period, subscriptions, payments, rates);
          for (const item of items) {
            const customer = customers.find((candidate) => candidate.id === item.customerId);
            totalCommission += item.commission;
            dataRows.push([
              customer?.office_name ?? "Cliente", item.planName, item.billingPeriod === "ANNUAL" ? "Anual" : "Mensal",
              money.format(item.subscriptionValue), money.format(item.commissionBase),
              item.ratePercent === null ? "não definida" : `${item.ratePercent}%`, money.format(item.commission),
              item.paymentDate ? new Date(item.paymentDate).toLocaleDateString("pt-BR") : "—",
            ]);
          }
        }

        const totalsRow = ["Total do período", "", "", "", "", "", money.format(totalCommission), ""];
        const subtitle = `${actor.name} · ${roleLabels[actor.role]} · ${periodLabel(period)}`;
        const filenameBase = `repasse-${slugify(actor.name)}-${period}${demoMode ? "-exemplo" : ""}`;

        if (reportFormat === "pdf") {
          // Sequential on purpose: one PDF at a time avoids the browser blocking a burst of simultaneous downloads.
          await downloadBrandedPdf({ title: "Relatório de Repasse", subtitle, banner: demoMode ? DEMO_BANNER : undefined, columns, rows: dataRows, rightAlignColumns: [3, 4, 6], totalsRow, filename: `${filenameBase}.pdf` });
        } else {
          downloadBrandedXlsx(`${filenameBase}.xlsx`, [{ name: "Repasse", title: `Chat Jurídico — Relatório de Repasse (${actor.name})`, subtitle, columns, rows: dataRows, totalsRow }]);
        }
        if (index < targets.length - 1) await new Promise((resolve) => setTimeout(resolve, 350));
      }
      toast.success(`Relatório gerado para ${targets.length} cadastro(s)${demoMode ? " (dados fictícios)" : ""}.`);
    } finally {
      setExporting(false);
    }
  }

  const historyRows = historyActor ? payouts.filter((payout) => payout.actor_id === historyActor.id).sort((a, b) => b.reference_month.localeCompare(a.reference_month)) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5 rounded-xl bg-slate-100 dark:bg-muted p-1">
          {ROLE_TABS.map((tab) => (
            <button key={tab} onClick={() => setRole(tab)} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${role === tab ? "bg-white dark:bg-card text-primary shadow-sm" : "text-slate-500 dark:text-muted-foreground hover:text-slate-700 dark:hover:text-foreground"}`}>
              {rolePluralLabels[tab]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-muted-foreground">
          Período
          <Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="w-40" />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-4"><p className="text-xs text-slate-500 dark:text-muted-foreground">Comissão calculada — {periodLabel(period)}</p><p className="mt-1 text-xl font-semibold">{money.format(totalComputed)}</p></div>
        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-4"><p className="text-xs text-slate-500 dark:text-muted-foreground">Já repassado neste período</p><p className="mt-1 text-xl font-semibold text-[#3b82f6]">{money.format(totalPaid)}</p></div>
        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-4"><p className="text-xs text-slate-500 dark:text-muted-foreground">Pendentes de repasse</p><p className="mt-1 text-xl font-semibold">{pendingCount}</p></div>
      </div>

      <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 dark:border-input bg-slate-50 dark:bg-muted p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600 dark:text-muted-foreground">{selectedActorIds.size} selecionado(s) para relatório (a seleção vale para todas as categorias, não só a aba atual)</p>
          <Select value={reportFormat} onValueChange={(value) => setReportFormat(value as "pdf" | "xlsx")}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex max-w-md items-center gap-2 text-xs text-slate-500 dark:text-muted-foreground">
            <Switch checked={demoMode} onCheckedChange={setDemoMode} />
            Usar dados fictícios (demonstração) — gera números de exemplo para {rolePluralLabels[role].toLowerCase()}, ignorando a seleção. Útil para ver o layout antes de preencher os dados reais.
          </label>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" disabled={exporting} onClick={exportAccountingReport}><FileDown className="size-3.5" />Relatório para contabilidade</Button>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={exporting} onClick={exportPartnerReports}><FileDown className="size-3.5" />Relatório por parceiro</Button>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-100 dark:border-border p-5">
          <h2 className="font-semibold">Repasses — {rolePluralLabels[role]}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">% de comissão sobre o MRR do plano. Anual: distribuída pelos 12 meses do ciclo enquanto a assinatura estiver ativa, independente de ter sido pago em 1x, 8x, 10x ou 12x. Mensal: só no mês em que o pagamento é confirmado.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-border p-4">
          {payoutStatusFilters.map((value) => (
            <button key={value} onClick={() => setPayoutStatusFilter(value)} className={`rounded-lg px-3 py-1.5 text-sm ${payoutStatusFilter === value ? "bg-accent text-accent-foreground" : "text-slate-500 dark:text-muted-foreground hover:bg-slate-50 dark:hover:bg-muted"}`}>
              {payoutStatusFilterLabels[value]}
            </button>
          ))}
          <Input className="ml-auto w-56" placeholder="Buscar pelo nome" value={nameSearch} onChange={(event) => setNameSearch(event.target.value)} />
          <ColumnVisibilityMenu defs={payoutColumns} isVisible={columns.isVisible} toggle={columns.toggle} />
        </div>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} /></TableHead>
              <ResizableTh {...sorting.header("name")} width={widths.getWidth("name", 220)} onResizeStart={widths.startResize("name", 220)}>Nome</ResizableTh>
              {columns.isVisible("received") && <ResizableTh {...sorting.header("received")} width={widths.getWidth("received")} onResizeStart={widths.startResize("received")} className="text-right">Recebido no período</ResizableTh>}
              {columns.isVisible("commission") && <ResizableTh {...sorting.header("commission")} width={widths.getWidth("commission")} onResizeStart={widths.startResize("commission")} className="text-right">Comissão calculada</ResizableTh>}
              {columns.isVisible("status") && <ResizableTh {...sorting.header("status")} width={widths.getWidth("status")} onResizeStart={widths.startResize("status")}>Status</ResizableTh>}
              <TableHead className="w-[300px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 && <TableRow><TableCell colSpan={columns.visibleCount + 3} className="text-center text-sm text-slate-500 dark:text-muted-foreground">Nenhum registro em {rolePluralLabels[role].toLowerCase()} nesse filtro.</TableCell></TableRow>}
            {sorting.rows(visibleRows, row => ({ name: row.actor.name, received: row.computed.grossReceived, commission: row.computed.commission, status: row.paidRecord ? "Pago" : "Pendente" })).map(({ actor, computed, paidRecord }) => (
              <TableRow key={actor.id}>
                <TableCell><Checkbox checked={selectedActorIds.has(actor.id)} onCheckedChange={(checked) => toggleActorSelected(actor.id, checked === true)} /></TableCell>
                <TableCell>
                  <p className="font-medium">{actor.name}</p>
                  {computed.untaxedCount > 0 && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-300"><TriangleAlert className="size-3" />{computed.untaxedCount} pagamento(s) sem taxa definida (não incluídos)</p>
                  )}
                </TableCell>
                {columns.isVisible("received") && <TableCell className="text-right">{money.format(computed.grossReceived)}</TableCell>}
                {columns.isVisible("commission") && <TableCell className="text-right font-medium">{money.format(computed.commission)}</TableCell>}
                {columns.isVisible("status") && (
                  <TableCell>
                    {paidRecord ? (
                      <Badge variant="outline" className="border-[#3b82f6]/30 text-[#3b82f6]">Pago em {new Date(paidRecord.paid_at).toLocaleDateString("pt-BR")} · {money.format(paidRecord.amount)}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-slate-500 dark:text-muted-foreground">Pendente</Badge>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setHistoryActor(actor)}><History className="size-3.5" />Histórico</Button>
                    {paidRecord ? (
                      <>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openMarkPaid(actor, computed.commission, paidRecord)}>Editar</Button>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => undoPaid(paidRecord, actor.name)}><Undo2 className="size-3.5" /><span className="sr-only">Desfazer</span></Button>
                      </>
                    ) : (
                      <Button size="sm" className="h-7 bg-[#3a5d9d] text-xs text-white hover:bg-[#2c4a80]" onClick={() => openMarkPaid(actor, computed.commission, null)}>Marcar como pago</Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <Dialog open={dialogActor !== null} onOpenChange={(open) => !open && setDialogActor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar repasse como pago</DialogTitle>
            <DialogDescription>{dialogActor?.name} · {periodLabel(period)} — valor calculado: {money.format(dialogComputedAmount)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500 dark:text-muted-foreground">R$</span>
              <Input type="number" step="0.01" value={dialogAmount} onChange={(event) => setDialogAmount(event.target.value)} />
            </div>
            <Input value={dialogNotes} onChange={(event) => setDialogNotes(event.target.value)} placeholder="Observação (opcional)" />
          </div>
          <DialogFooter><Button disabled={saving} onClick={confirmMarkPaid}>{saving ? "Salvando…" : "Confirmar pagamento"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyActor !== null} onOpenChange={(open) => !open && setHistoryActor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Histórico de repasses — {historyActor?.name}</DialogTitle>
            <DialogDescription>Todos os meses já marcados como pagos.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {historyRows.length === 0 && <p className="text-sm text-slate-500 dark:text-muted-foreground">Nenhum repasse pago ainda.</p>}
            {historyRows.map((payout) => (
              <div key={payout.id} className="rounded-lg border border-slate-100 dark:border-border p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{periodLabel(payout.reference_month.slice(0, 7))}</span>
                  <span className="font-medium text-[#3b82f6]">{money.format(payout.amount)}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-muted-foreground">Pago em {new Date(payout.paid_at).toLocaleDateString("pt-BR")}{payout.computed_amount !== payout.amount ? ` · calculado: ${money.format(payout.computed_amount)}` : ""}</p>
                {payout.notes && <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">{payout.notes}</p>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
