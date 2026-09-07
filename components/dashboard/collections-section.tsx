"use client";
import { CollectionRuleEditor } from "./collection-rule-editor";
import { CollectionKanban } from "./collection-kanban";
import { CollectionHistory } from "./collection-history";
import { CollectionReports } from "./collection-reports";
import type { CollectionReport, ReportRow } from "@/lib/collection-report-types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { money, type Customer, type Payment } from "@/lib/metrics";
import { type CollectionPreview } from "@/lib/collection-policy";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type HistoryRow = { id: string; action: string; after_json: CollectionPreview & { original_status?: string; source?: { file?: string } }; created_at: string };
export function CollectionsSection({ payments }: { payments: Payment[]; customers: Customer[] }) {
  const [view,setView]=useState("reports");
  const [reportData,setReportData]=useState<ReportRow[]>([]);
  const [report, setReport] = useState<CollectionReport | null>(null);
  const [rows, setRows] = useState<CollectionPreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  async function load() {
    setBusy(true); setError(""); setRows(null); setResults({});
    try {
      const r = await fetch(`/api/collections?reportId=${report?.id ?? ""}`); const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setRows(data.rows);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível consultar."); }
    finally { setBusy(false); }
  }
  async function send(row: CollectionPreview) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: row.payment.id, approval: row.approval, approved: true }) });
      const data = await r.json();
      setResults(current => ({ ...current, [row.payment.id]: r.ok ? "Enviado" : data.error }));
    } catch { setResults(current => ({ ...current, [row.payment.id]: "Resposta não confirmada. Consulte o histórico antes de repetir." })); }
    finally { setBusy(false); }
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
  const blocked = rows?.filter(row => row.blocked) ?? [];
  return <div className="space-y-6">
    <nav className="flex flex-wrap gap-2">{[["reports","Relatórios"],["kanban","Kanban"],["rules","Configurar régua"],["history","Histórico"]].map(([id,label])=><Button key={id} variant={view===id?"default":"outline"} onClick={()=>setView(id)}>{label}</Button>)}</nav>
    <div hidden={view!=="reports"}><CollectionReports onSelect={(selected, saved, data) => { setReport(selected); setReportData(data); setRows(saved.length ? saved : null); setResults({}); }} /></div>
    {view==="kanban"&&<CollectionKanban rows={reportData}/>}
    {view==="rules"&&<CollectionRuleEditor customers={reportData}/>}
    {view==="history"&&<CollectionHistory/>}
    <div hidden={view!=="reports"} className="space-y-6">
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Régua de cobrança</h2>
      <p className="mt-2 text-sm text-muted-foreground">Prepare as mensagens do relatório selecionado. O vínculo com o Chat Jurídico é conferido pelo identificador do pagamento Asaas.</p>
      <p className="text-xs text-muted-foreground">A base local do Asaas tem {payments.filter(p => p.status === "OVERDUE").length} pagamento(s) em atraso. As prévias usam o relatório Asaas selecionado e os contatos ativos do Chat Jurídico.</p>
      <div className="mt-5 flex flex-wrap gap-3"><Button disabled={busy || !report || report.status !== "COMPLETE" || report.mode === "ALL"} onClick={load}>{busy ? "Processando…" : "Preparar prévias do relatório"}</Button><Button disabled={busy} variant="outline" onClick={exportHistory}>Exportar histórico do mês</Button></div>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </section>
    {rows && <section className="space-y-4"><h3 className="font-semibold">Prévias para aprovação · {eligible.length}</h3>{!eligible.length && <p className="text-sm text-muted-foreground">Nenhuma mensagem elegível para envio hoje.</p>}{eligible.map(row => <article key={row.payment.id} className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap justify-between gap-2"><div><h4 className="font-medium">{row.contact?.name ?? row.payment.contact_name}</h4><p className="text-sm text-muted-foreground">{row.contact?.phone} · {money.format(row.payment.value)} · Vencimento: {row.payment.due_date?.split("-").reverse().join("/")}</p></div><span className="text-xs text-muted-foreground">{row.stage}</span></div>
      <p className="my-4 whitespace-pre-wrap rounded-xl bg-muted/50 p-4 text-sm">{row.text}</p>
      {results[row.payment.id] ? <p role="status" className="text-sm">{results[row.payment.id]}</p> : <Button disabled={busy || !row.approval} onClick={() => send(row)}>{row.approval ? "Aprovar e enviar esta mensagem" : "Prévia salva — prepare novamente para enviar"}</Button>}
    </article>)}</section>}
    {!!blocked.length && <section className="overflow-hidden rounded-2xl border bg-card"><div className="p-5"><h3 className="font-semibold">Sem envio · {blocked.length}</h3><p className="text-sm text-muted-foreground">Contatos inativos e pendências de template ou canal ficam fora da aprovação.</p></div><Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Vencimento</TableHead><TableHead>Valor</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader><TableBody>{blocked.map(row => <TableRow key={row.payment.id}><TableCell>{row.contact?.name ?? row.payment.contact_name ?? "Não identificado"}</TableCell><TableCell>{row.payment.due_date}</TableCell><TableCell>{money.format(row.payment.value)}</TableCell><TableCell>{row.blocked}</TableCell></TableRow>)}</TableBody></Table></section>}
    {!!history.length && <p className="text-sm text-muted-foreground">Histórico exportado: {history.filter(row => row.action === "SENT").length} envio(s) confirmado(s), {history.filter(row => row.action !== "SENT").length} tentativa(s) para revisão.</p>}
    </div>
  </div>;
}