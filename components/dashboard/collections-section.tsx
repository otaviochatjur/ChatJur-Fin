"use client";
import { collectionPaymentMethod } from "@/lib/collection-payment-method";
import { CollectionScheduleEditor } from "./collection-schedule-editor";
import { CollectionRuleEditor } from "./collection-rule-editor";
import { CollectionKanban } from "./collection-kanban";
import { CollectionHistory } from "./collection-history";
import { CollectionReports } from "./collection-reports";
import type { CollectionReport, ReportRow } from "@/lib/collection-report-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { money, type Customer, type Payment } from "@/lib/metrics";
import { type CollectionPreview } from "@/lib/collection-policy";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { runCollectionBatch, selectedCollectionPreviews } from "@/lib/collection-batch";
import type { ChatInstance } from "@/lib/chat-juridico-server";
import { preferredCollectionInstance } from "@/lib/collection-sender";

type HistoryRow = { id: string; action: string; after_json: CollectionPreview & { original_status?: string; source?: { file?: string } }; created_at: string };
export function CollectionsSection({ payments }: { payments: Payment[]; customers: Customer[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const sending = useRef(false);
  const stopRequested = useRef(false);
  useEffect(() => () => { stopRequested.current = true; }, []);
  const [view,setView]=useState("reports");
  const [reportData,setReportData]=useState<ReportRow[]>([]);
  const [report, setReport] = useState<CollectionReport | null>(null);
  const [rows, setRows] = useState<CollectionPreview[] | null>(null);
  const methodByPayment = new Map(reportData.map(row => [row.snapshot.payment_id, collectionPaymentMethod(row.snapshot.billing_type)]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [instances, setInstances] = useState<ChatInstance[]>([]);
  const [senderId, setSenderId] = useState("");
  const [instanceError, setInstanceError] = useState("");
  const approvedTemplates = instances.find(instance => instance.id === senderId)?.approved_template_names ?? [];
  useEffect(() => {
    let stopped = false;
    fetch("/api/collections/instances", { signal: AbortSignal.timeout(20000) }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (!stopped) { setInstances(data.instances ?? []); setSenderId(current => current || preferredCollectionInstance(data.instances ?? [])); }
    }).catch(error => { if (!stopped) setInstanceError(error instanceof Error ? error.message : "Falha ao consultar números."); });
    return () => { stopped = true; };
  }, []);
  async function load() {
    setBusy(true); setError(""); setRows(null); setResults({}); setProgress(null);
    try {
      if (!senderId) throw new Error("Escolha um número conectado do Chat Jurídico.");
      if (!selected.size) throw new Error("Selecione ao menos uma cobrança apta no relatório.");
      const r = await fetch("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", reportId: report?.id ?? "", instanceId: senderId, paymentIds: [...selected] }), signal: AbortSignal.timeout(120000) }); const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setRows(data.rows);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível consultar."); }
    finally { setBusy(false); }
  }
  async function sendBatch(batch: CollectionPreview[]) {
    if (sending.current) return;
    if (!batch.length) return;
    sending.current = true; stopRequested.current = false;
    setBusy(true); setError(""); setProgress({ completed: 0, total: batch.length });
    try {
      await runCollectionBatch(batch, async row => {
        const r = await fetch("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: row.payment.id, instanceId: senderId, approval: row.approval, approved: true }), signal: AbortSignal.timeout(60000) });
        const data = await r.json();
        return { ok: r.ok, message: r.ok ? "Enviado" : data.error ?? "Falha no envio. Consulte o histórico." };
      }, (row, result, completed) => {
        setResults(current => ({ ...current, [row.payment.id]: result.message }));
        if (result.ok) setSelected(current => { const next = new Set(current); next.delete(row.payment.asaas_payment_id ?? row.payment.id); return next; });
        setProgress({ completed, total: batch.length });
        if (!result.ok) setError(`Lote pausado: ${result.message}`);
      }, () => stopRequested.current);
    } finally { sending.current = false; setBusy(false); }
  }
  async function sendSelected() { await sendBatch(selectedCollectionPreviews(rows ?? [], selected, results)); }
  async function exportHistory() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/collections/history"); const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setHistory(data.rows);
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const records = data.rows.map((item: HistoryRow) => ({ "Data de execução": new Date(item.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), "Cliente": item.after_json.contact?.name ?? item.after_json.payment.contact_name, "Celular": item.after_json.contact?.phone, "Template": item.after_json.stage, "Vencimento": item.after_json.payment.due_date, "Valor": item.after_json.payment.value, "Dias em atraso": item.after_json.days, "Status": item.after_json.original_status ?? (item.action === "SENT" ? "Enviado" : item.action === "SKIPPED" ? "Pulado" : "Revisar tentativa"), "Origem": item.after_json.source?.file ?? "Sistema" }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(records), "Cobranças");
      XLSX.writeFile(workbook, `Cobranca_${data.month.replace("-", "_")}.xlsx`);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível exportar."); }
    finally { setBusy(false); }
  }
  const handleReportSelect = useCallback((selectedReport: CollectionReport, _saved: CollectionPreview[], data: ReportRow[]) => {
    setReport(selectedReport); setReportData(data); setRows(null); setResults({}); setSelected(new Set()); setProgress(null);
  }, []);
  const eligible = rows?.filter(row => !row.blocked) ?? [];
  const selectable = eligible.filter(row => row.approval && !results[row.payment.id]);
  const selectedCount = selectedCollectionPreviews(rows ?? [], selected, results).length;
  const blocked = rows?.filter(row => row.blocked) ?? [];
  return <div className="space-y-6">
    <nav className="flex flex-wrap gap-2">{[["reports","Régua do dia"],["kanban","Kanban"],["rules","Configurar régua"],["history","Histórico"],["schedule","Programação"]].map(([id,label])=><Button key={id} disabled={busy} variant={view===id?"default":"outline"} onClick={()=>setView(id)}>{label}</Button>)}</nav>
    {view==="reports"&&<section className="rounded-2xl border bg-card p-5 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-lg font-semibold">Número para os disparos</h2><p className="mt-1 text-sm text-muted-foreground">O número Financeiro já fica selecionado. A régua e os templates abaixo usam este remetente.</p></div><label className="min-w-72 text-sm">Enviar pelo número<select aria-label="Número remetente do Chat Jurídico" className="mt-1 block h-10 w-full rounded-md border bg-card px-3" value={senderId} disabled={busy} onChange={event => { setSenderId(event.target.value); setRows(null); setResults({}); setSelected(new Set()); }}><option value="">Escolha um número conectado</option>{instances.map(instance => <option key={instance.id} value={instance.id}>{instance.name || "WhatsApp"} · {instance.display_phone_number || instance.phone_id || instance.id} · {instance.approved_template_count ?? 0} templates</option>)}</select></label></div>{instanceError && <p role="alert" className="mt-3 text-sm text-destructive">{instanceError}</p>}</section>}
    <fieldset disabled={busy} hidden={view!=="reports"}><CollectionReports approvedTemplates={approvedTemplates} selectedPayments={selected} onSelectionChange={setSelected} onSelect={handleReportSelect} /></fieldset>
    {view==="kanban"&&<CollectionKanban rows={reportData}/>}
    {view==="rules"&&<CollectionRuleEditor customers={reportData}/>}
    {view==="history"&&<CollectionHistory/>}
    {view==="schedule"&&<CollectionScheduleEditor/>}
    <div hidden={view!=="reports"} className="space-y-6">
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Régua de cobrança</h2>
      <p className="mt-2 text-sm text-muted-foreground">Marque as cobranças aptas no relatório e prepare somente as mensagens que deseja revisar.</p>
      <p className="text-xs text-muted-foreground">A base local do Asaas tem {payments.filter(p => p.status === "OVERDUE").length} pagamento(s) em atraso. O telefone atual do cliente é confirmado no Asaas; o contato será localizado ou criado no número escolhido somente no disparo.</p>
      <div className="mt-5 flex flex-wrap items-end gap-3"><Button disabled={busy || !senderId || !report || report.status !== "COMPLETE" || report.mode === "ALL" || !selected.size} onClick={load}>{busy ? "Processando…" : `Preparar mensagens selecionadas (${selected.size})`}</Button><Button disabled={busy} variant="outline" onClick={exportHistory}>Exportar histórico do mês</Button><p className="text-xs text-muted-foreground">Remetente: {instances.find(instance => instance.id === senderId)?.name ?? "não selecionado"}</p></div>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </section>
    {rows && <section className="space-y-4"><h3 className="font-semibold">Mensagens completas para aprovação · {eligible.length}</h3>{!eligible.length && <p className="text-sm text-muted-foreground">Nenhuma mensagem elegível para envio hoje nesse número.</p>}{!!eligible.length && <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 shadow-sm"><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy || !selectable.length} checked={selectable.length > 0 && selectedCount === selectable.length} onChange={e => setSelected(e.target.checked ? new Set(selectable.map(row => row.payment.asaas_payment_id ?? row.payment.id)) : new Set())} />Selecionar aptos ({selectable.length})</label><Button disabled={busy || !selectedCount} onClick={sendSelected}>Disparar selecionadas pelo Chat Jurídico ({selectedCount})</Button>{busy && progress && <Button variant="outline" onClick={() => { stopRequested.current = true; setError("Pausa solicitada. A mensagem em andamento será concluída; as próximas não serão enviadas."); }}>Pausar após esta mensagem</Button>}{progress && <p role="status" className="text-sm text-muted-foreground">{progress.completed} de {progress.total} processadas</p>}<p className="w-full text-xs text-muted-foreground">Revise os textos completos abaixo. O disparo usa {instances.find(instance => instance.id === senderId)?.display_phone_number ?? "o número escolhido"}.</p></div>}{eligible.map(row => <article key={row.payment.id} className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap justify-between gap-2"><div><label className="flex items-center gap-2 font-medium"><input type="checkbox" aria-label={`Selecionar cobrança de ${row.contact?.name ?? row.payment.contact_name}`} disabled={busy || !row.approval || Boolean(results[row.payment.id])} checked={selected.has(row.payment.asaas_payment_id ?? row.payment.id)} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(row.payment.asaas_payment_id ?? row.payment.id); else next.delete(row.payment.asaas_payment_id ?? row.payment.id); return next; })} />{row.contact?.name ?? row.payment.contact_name}</label><p className="text-sm text-muted-foreground">{row.contact?.phone} · {methodByPayment.get(row.payment.asaas_payment_id ?? row.payment.id) ?? "Não informado"} · {money.format(row.payment.value)} · Vencimento: {row.payment.due_date?.split("-").reverse().join("/")}</p></div><span className="text-xs text-muted-foreground">{row.stage}</span></div>
      <div className="my-4 rounded-xl bg-muted/50 p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mensagem completa</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{row.text}</p></div>
      {results[row.payment.id] ? <p role="status" className="text-sm">{results[row.payment.id]}</p> : <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{row.approval ? "Revise o texto e dispare individualmente ou inclua no lote." : "Prévia salva — prepare novamente para enviar"}</p><Button size="sm" disabled={busy || !row.approval} onClick={() => void sendBatch([row])}>Disparar esta mensagem</Button></div>}
    </article>)}</section>}
    {!!blocked.length && <section className="overflow-hidden rounded-2xl border bg-card"><div className="p-5"><h3 className="font-semibold">Sem envio · {blocked.length}</h3><p className="text-sm text-muted-foreground">Clientes sem status Ativo e pendências de telefone, template ou canal ficam fora da aprovação.</p></div><Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Vencimento</TableHead><TableHead>Valor</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader><TableBody>{blocked.map(row => <TableRow key={row.payment.id}><TableCell>{row.contact?.name ?? row.payment.contact_name ?? "Não identificado"}</TableCell><TableCell>{row.payment.due_date}</TableCell><TableCell>{money.format(row.payment.value)}</TableCell><TableCell>{row.blocked}</TableCell></TableRow>)}</TableBody></Table></section>}
    {!!history.length && <p className="text-sm text-muted-foreground">Histórico exportado: {history.filter(row => row.action === "SENT").length} envio(s) confirmado(s), {history.filter(row => row.action !== "SENT").length} tentativa(s) para revisão.</p>}
    </div>
  </div>;
}
