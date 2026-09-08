"use client";
import { collectionPaymentMethod } from "@/lib/collection-payment-method";
import { CollectionScheduleEditor } from "./collection-schedule-editor";
import { CollectionRuleEditor } from "./collection-rule-editor";
import { CollectionKanban } from "./collection-kanban";
import { CollectionHistory } from "./collection-history";
import { CollectionReports } from "./collection-reports";
import type { CollectionReport, ReportRow } from "@/lib/collection-report-types";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { money, type Customer, type Payment } from "@/lib/metrics";
import { type CollectionPreview } from "@/lib/collection-policy";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { runCollectionBatch, selectedCollectionPreviews, selectedChatPaymentIds } from "@/lib/collection-batch";

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
  const selectedChatIds = selectedChatPaymentIds(rows ?? [], selected);
  const methodByPayment = new Map(reportData.map(row => [row.snapshot.payment_id, collectionPaymentMethod(row.snapshot.billing_type)]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  async function load() {
    setBusy(true); setError(""); setRows(null); setResults({}); setProgress(null);
    try {
      const r = await fetch(`/api/collections?reportId=${report?.id ?? ""}`); const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setRows(data.rows);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível consultar."); }
    finally { setBusy(false); }
  }
  async function sendSelected() {
    if (sending.current) return;
    const batch = selectedCollectionPreviews(rows ?? [], selectedChatIds, results);
    if (!batch.length) return;
    sending.current = true; stopRequested.current = false;
    setBusy(true); setError(""); setProgress({ completed: 0, total: batch.length });
    try {
      await runCollectionBatch(batch, async row => {
        const r = await fetch("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: row.payment.id, approval: row.approval, approved: true }), signal: AbortSignal.timeout(60000) });
        const data = await r.json();
        return { ok: r.ok, message: r.ok ? "Enviado" : data.error ?? "Falha no envio. Consulte o histórico." };
      }, (row, result, completed) => {
        setResults(current => ({ ...current, [row.payment.id]: result.message }));
        setSelected(current => { const next = new Set(current); next.delete(row.payment.asaas_payment_id ?? row.payment.id); return next; });
        setProgress({ completed, total: batch.length });
        if (!result.ok) setError("Lote pausado por uma falha. Confira o resultado e o histórico antes de continuar com as demais mensagens.");
      }, () => stopRequested.current);
    } finally { sending.current = false; setBusy(false); }
  }
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
  const eligible = rows?.filter(row => !row.blocked) ?? [];
  const selectable = eligible.filter(row => row.approval && !results[row.payment.id]);
  const selectedCount = selectedCollectionPreviews(rows ?? [], selectedChatIds, results).length;
  const blocked = rows?.filter(row => row.blocked) ?? [];
  return <div className="space-y-6">
    <nav className="flex flex-wrap gap-2">{[["reports","Relatórios"],["kanban","Kanban"],["rules","Configurar régua"],["history","Histórico"],["schedule","Programação"]].map(([id,label])=><Button key={id} disabled={busy} variant={view===id?"default":"outline"} onClick={()=>setView(id)}>{label}</Button>)}</nav>
    <fieldset disabled={busy} hidden={view!=="reports"}><CollectionReports selectedPayments={selected} onSelectionChange={setSelected} onSelect={(selected, saved, data) => { setReport(selected); setReportData(data); setRows(saved.length ? saved : null); setResults({}); setSelected(new Set()); setProgress(null); }} /></fieldset>
    {view==="kanban"&&<CollectionKanban rows={reportData}/>}
    {view==="rules"&&<CollectionRuleEditor customers={reportData}/>}
    {view==="history"&&<CollectionHistory/>}
    {view==="schedule"&&<CollectionScheduleEditor/>}
    <div hidden={view!=="reports"} className="space-y-6">
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Régua de cobrança</h2>
      <p className="mt-2 text-sm text-muted-foreground">Prepare as mensagens do relatório selecionado. O vínculo com o Chat Jurídico é conferido pelo identificador do pagamento Asaas.</p>
      <p className="text-xs text-muted-foreground">A base local do Asaas tem {payments.filter(p => p.status === "OVERDUE").length} pagamento(s) em atraso. As prévias usam o relatório Asaas selecionado e os contatos ativos do Chat Jurídico.</p>
      <div className="mt-5 flex flex-wrap gap-3"><Button disabled={busy || !report || report.status !== "COMPLETE" || report.mode === "ALL"} onClick={load}>{busy ? "Processando…" : "Preparar prévias do relatório"}</Button><Button disabled={busy} variant="outline" onClick={exportHistory}>Exportar histórico do mês</Button></div>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </section>
    {rows && <section className="space-y-4"><h3 className="font-semibold">Prévias para aprovação · {eligible.length}</h3>{!eligible.length && <p className="text-sm text-muted-foreground">Nenhuma mensagem elegível para envio hoje.</p>}{!!eligible.length && <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 shadow-sm"><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy || !selectable.length} checked={selectable.length > 0 && selectedCount === selectable.length} onChange={e => setSelected(e.target.checked ? new Set(selectable.map(row => row.payment.asaas_payment_id ?? row.payment.id)) : new Set())} />Selecionar aptos ({selectable.length})</label><Button disabled={busy || !selectedCount} onClick={sendSelected}>Aprovar e enviar selecionadas ({selectedCount})</Button>{busy && progress && <Button variant="outline" onClick={() => { stopRequested.current = true; setError("Pausa solicitada. A mensagem em andamento será concluída; as próximas não serão enviadas."); }}>Pausar após esta mensagem</Button>}{progress && <p role="status" className="text-sm text-muted-foreground">{progress.completed} de {progress.total} processadas</p>}<p className="w-full text-xs text-muted-foreground">Cada seleção corresponde à cobrança e ao texto abaixo. Uma pessoa com mais de uma cobrança pode receber mais de uma mensagem.</p></div>}{eligible.map(row => <article key={row.payment.id} className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap justify-between gap-2"><div><label className="flex items-center gap-2 font-medium"><input type="checkbox" aria-label={`Selecionar cobrança de ${row.contact?.name ?? row.payment.contact_name}`} disabled={busy || !row.approval || Boolean(results[row.payment.id])} checked={selected.has(row.payment.asaas_payment_id ?? row.payment.id)} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(row.payment.asaas_payment_id ?? row.payment.id); else next.delete(row.payment.asaas_payment_id ?? row.payment.id); return next; })} />{row.contact?.name ?? row.payment.contact_name}</label><p className="text-sm text-muted-foreground">{row.contact?.phone} · {methodByPayment.get(row.payment.asaas_payment_id ?? row.payment.id) ?? "Não informado"} · {money.format(row.payment.value)} · Vencimento: {row.payment.due_date?.split("-").reverse().join("/")}</p></div><span className="text-xs text-muted-foreground">{row.stage}</span></div>
      <p className="my-4 whitespace-pre-wrap rounded-xl bg-muted/50 p-4 text-sm">{row.text}</p>
      {results[row.payment.id] ? <p role="status" className="text-sm">{results[row.payment.id]}</p> : <p className="text-xs text-muted-foreground">{row.approval ? "Marque esta cobrança para incluir no disparo." : "Prévia salva — prepare novamente para enviar"}</p>}
    </article>)}</section>}
    {!!blocked.length && <section className="overflow-hidden rounded-2xl border bg-card"><div className="p-5"><h3 className="font-semibold">Sem envio · {blocked.length}</h3><p className="text-sm text-muted-foreground">Contatos inativos e pendências de template ou canal ficam fora da aprovação.</p></div><Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Vencimento</TableHead><TableHead>Valor</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader><TableBody>{blocked.map(row => <TableRow key={row.payment.id}><TableCell>{row.contact?.name ?? row.payment.contact_name ?? "Não identificado"}</TableCell><TableCell>{row.payment.due_date}</TableCell><TableCell>{money.format(row.payment.value)}</TableCell><TableCell>{row.blocked}</TableCell></TableRow>)}</TableBody></Table></section>}
    {!!history.length && <p className="text-sm text-muted-foreground">Histórico exportado: {history.filter(row => row.action === "SENT").length} envio(s) confirmado(s), {history.filter(row => row.action !== "SENT").length} tentativa(s) para revisão.</p>}
    </div>
  </div>;
}