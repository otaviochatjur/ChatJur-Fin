"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { collectionPaymentMethod } from "@/lib/collection-payment-method";
import { ResizableTh, useTableSort, useColumnWidths } from "./table-toolbar";
import { money } from "@/lib/metrics";
import { isCollectionBusinessDay } from "@/lib/collection-calendar";
import { reportModeLabels, type CollectionReport, type ReportMode, type ReportRow } from "@/lib/collection-report-types";
import type { CollectionPreview } from "@/lib/collection-policy";

async function reportRequest(body?: unknown, query = "") {
  const r = await fetch(`/api/collections/reports${query}`, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Não foi possível consultar o relatório."); return data;
}
export function CollectionReports({ onSelect, selectedPayments, onSelectionChange, approvedTemplates }: { approvedTemplates: string[]; selectedPayments: Set<string>; onSelectionChange: (ids: Set<string>) => void; onSelect: (report: CollectionReport, savedPreviews: CollectionPreview[], rows: ReportRow[]) => void }) {
  const sorting = useTableSort(), widths = useColumnWidths();
  const [reports, setReports] = useState<CollectionReport[]>([]);
  const [mode, setMode] = useState<ReportMode>("OPEN");
  const [selected, setSelected] = useState<CollectionReport | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [page, setPage] = useState(0);
  const [detail, setDetail] = useState<ReportRow | null>(null);
  const stopped = useRef(false), running = useRef(false);
  useEffect(() => {
    stopped.current = false;
    reportRequest().then(data => { if (!stopped.current) setReports(data.reports); }).catch(e => { if (!stopped.current) setError(e.message); });
    return () => { stopped.current = true; };
  }, []);
  async function open(id: string) {
    const data = await reportRequest(undefined, `?id=${id}`);
    if (stopped.current) return;
    setSelected(data.report); setRows(data.rows); setPage(0); setSearch(""); setDetail(null);
    onSelect(data.report, data.review?.rows ?? [], data.rows);
  }
  async function generate(existing?: CollectionReport) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setRows([]); setDetail(null);
    try {
      let report: CollectionReport = existing ?? (await reportRequest({ action: "create", mode })).report;
      setSelected(report); onSelect(report, [], []);
      while (report.status !== "COMPLETE" && !stopped.current) {
        report = (await reportRequest({ action: "advance", id: report.id })).report;
        if (!stopped.current) setSelected(report);
      }
      if (!stopped.current) { await open(report.id); setReports((await reportRequest()).reports); }
    } catch (e) {
      if (!stopped.current) {
        setError((e instanceof Error ? e.message : "Falha na geração.") + " O progresso já salvo pode ser retomado.");
        try { setReports((await reportRequest()).reports); } catch { /* retain current report */ }
      }
    } finally { running.current = false; if (!stopped.current) setBusy(false); }
  }
  async function exportReport() {
    if (!selected) return;
    const XLSX = await import("xlsx"); const book = XLSX.utils.book_new();
    const data = rows.map(({ snapshot: r }) => ({ "Pagamento Asaas": r.payment_id, "Cliente Asaas": r.customer_id, "Nome": r.name, "E-mail": r.email, "Celular": r.phone, "Vencimento": r.due_date, "Valor": r.value, "Status Asaas": r.status, "Forma de pagamento": collectionPaymentMethod(r.billing_type), "Descrição": r.description, "Dias": r.days, "Etapa": r.stage ?? "Sem envio hoje", "Gatilho": r.trigger, "Data nominal": r.nominal, "Data efetiva": r.effective, "Fatura": r.invoice_url, "Boleto": r.bankslip_url, "Pix copia e cola": r.pix_payload, "Pix expiração": r.pix_expiration, "Pendências": r.warnings.join("; ") }));
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data), "Relatório");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ "Tipo": reportModeLabels[selected.mode], "Data da consulta": selected.report_date, "Situação": selected.status, "Registros": rows.length, "ID": selected.id }]), "Execução");
    XLSX.writeFile(book, `Relatorio_${selected.mode}_${selected.report_date}_${selected.id.slice(0,8)}.xlsx`);
  }
  const filtered = rows.filter(row => [row.snapshot.name,row.snapshot.email,row.snapshot.payment_id,row.snapshot.stage,row.snapshot.status,collectionPaymentMethod(row.snapshot.billing_type)].some(value => value?.toLowerCase().includes(search.toLowerCase())));
  const ordered = sorting.rows(filtered, ({ snapshot: row }) => ({ client: row.name, due: row.due_date, value: Number(row.value), status: row.status, method: collectionPaymentMethod(row.billing_type), stage: [row.stage ?? 'Sem envio hoje', ...row.warnings].join(' · ') }));
  const selectionBlock = (row: ReportRow) => {
    if (selected?.mode === 'ALL') return 'O relatório completo é somente para consulta.';
    if (!['PENDING','OVERDUE'].includes(row.snapshot.status)) return 'A cobrança não está em aberto.';
    if (row.customer_found === false) return 'Cliente do Asaas ainda não sincronizado na base. Sincronize a base para confirmar o status.';
    if (row.customer_status !== 'ACTIVE') return 'Cliente sem status Ativo confirmado.';
    if (!row.snapshot.stage) return 'Esta cobrança não possui etapa da régua para hoje.';
    const phone = row.snapshot.phone?.replace(/\D/g, '') ?? '';
    if (phone.length < 10 || phone.length > 13) return 'O cliente não possui telefone válido no Asaas.';
    if (!approvedTemplates.includes(row.snapshot.stage)) return 'O número escolhido não possui o template aprovado para esta etapa.';
    return null;
  };
  const canSelect = (row: ReportRow) => selectionBlock(row) === null;
  const visibleSelectable = filtered.filter(canSelect);
  const allSelected = visibleSelectable.length > 0 && visibleSelectable.every(row => selectedPayments.has(row.snapshot.payment_id));
  function toggle(id: string, checked: boolean) { const next = new Set(selectedPayments); if (checked) next.add(id); else next.delete(id); onSelectionChange(next); }
  return <section className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
    <div><h2 className="text-lg font-semibold">Relatórios do Asaas</h2><p className="mt-1 text-sm text-muted-foreground">Cada geração fica salva no banco, com os dados e as pendências encontrados naquele momento.</p></div>
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-56 text-sm">Tipo de relatório<select className="mt-1 block h-10 w-full rounded-md border bg-card px-3" disabled={busy} value={mode} onChange={e => setMode(e.target.value as ReportMode)}>{Object.entries(reportModeLabels).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label><Button disabled={busy} onClick={() => void generate()}>{busy ? "Gerando e salvando…" : "Gerar relatório"}</Button></div>
    <p className="text-xs text-muted-foreground">Régua do dia: somente etapas previstas. Vencidas e a vencer: PENDING e OVERDUE. Todas: histórico da última base sincronizada, sem consultar o Asaas ou Pix. Etapas em dias não úteis são transferidas para o próximo dia útil; D+30 gera uma mensagem, sem cancelamento automático.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!!reports.length && <label className="block text-sm">Relatórios salvos<select disabled={busy} className="mt-1 h-10 w-full rounded-md border bg-card px-3" value={selected?.id ?? ""} onChange={e => { if (e.target.value) void open(e.target.value).catch(error => setError(error.message)); }}><option value="">Selecione uma execução</option>{reports.map(report => <option key={report.id} value={report.id}>{new Date(report.created_at).toLocaleString("pt-BR")} · {reportModeLabels[report.mode]} · {report.status === "COMPLETE" ? `${report.row_count} registros` : "Pode retomar"}</option>)}</select></label>}
    {reports.length >= 100 && <Button variant="ghost" disabled={busy} onClick={async () => { try { const data = await reportRequest(undefined, `?offset=${reports.length}`); setReports(current => [...current,...data.reports]); } catch(e) { setError(e instanceof Error ? e.message : "Falha ao carregar histórico."); } }}>Carregar execuções anteriores</Button>}
    {selected && <>
      <div role="status" className="rounded-xl bg-muted/50 p-4 text-sm"><p className="font-medium">{reportModeLabels[selected.mode]} · {selected.report_date.split("-").reverse().join("/")}</p><p className="mt-1">{selected.status === "COMPLETE" ? "Concluído e salvo" : "Em geração"} · {selected.processed} cobranças consultadas · {selected.row_count} registros salvos</p>{selected.source_generation && <p className="mt-1">Origem: base sincronizada · Atualizada em {selected.source_updated_at ? new Date(selected.source_updated_at).toLocaleString("pt-BR") : "—"}</p>}{!isCollectionBusinessDay(selected.report_date) && <p className="mt-1">Fim de semana ou feriado nacional: não há disparo da régua nesta data.</p>}{selected.status !== "COMPLETE" && !busy && <Button className="mt-3" onClick={() => void generate(selected)}>Retomar geração</Button>}</div>
      {selected.status === "COMPLETE" && <><div className="flex flex-wrap items-center gap-3"><Input className="max-w-sm" placeholder="Buscar cliente, status ou etapa" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /><Button variant="outline" onClick={() => void exportReport().catch(error => setError(error.message))}>Exportar Excel</Button><span className="text-sm text-muted-foreground">{filtered.length} registros · {money.format(filtered.reduce((sum,row) => sum+Number(row.snapshot.value),0))}</span></div>
      <p className="text-sm text-muted-foreground">{selectedPayments.size} cobrança(s) apta(s) selecionada(s). A seleção do cabeçalho inclui todas as páginas do filtro. A aptidão exige cobrança aberta, etapa para hoje, telefone válido e template aprovado no número remetente.</p>
      <Table><TableHeader><TableRow><TableHead><input type="checkbox" aria-label="Selecionar cobranças aptas do filtro em todas as páginas" disabled={!visibleSelectable.length} checked={allSelected} ref={element => { if (element) element.indeterminate = !allSelected && visibleSelectable.some(row => selectedPayments.has(row.snapshot.payment_id)); }} onChange={event => { const next = new Set(selectedPayments); for (const row of visibleSelectable) { if (event.target.checked) next.add(row.snapshot.payment_id); else next.delete(row.snapshot.payment_id); } onSelectionChange(next); }} /></TableHead>{[['client','Cliente',220],['due','Vencimento',140],['value','Valor',120],['method','Forma de pagamento',180],['status','Status',140],['stage','Etapa / pendências',240]].map(([key,label,width]) => <ResizableTh key={key} {...sorting.header(String(key))} onSort={() => { sorting.header(String(key)).onSort(); setPage(0); }} width={widths.getWidth(String(key),Number(width))} onResizeStart={widths.startResize(String(key),Number(width))}>{label}</ResizableTh>)}</TableRow></TableHeader><TableBody>{ordered.slice(page*50,page*50+50).map(row => { const blocked = selectionBlock(row); return <TableRow key={row.id}><TableCell><input type="checkbox" title={blocked ?? 'Apta para preparar e enviar'} aria-label={`Selecionar cobrança de ${row.snapshot.name}, vencimento ${row.snapshot.due_date}`} disabled={Boolean(blocked)} checked={selectedPayments.has(row.snapshot.payment_id)} onChange={event => toggle(row.snapshot.payment_id,event.target.checked)} /></TableCell><TableCell><button className="text-left font-medium underline-offset-4 hover:underline" onClick={() => setDetail(row)}>{row.snapshot.name}</button><p className="text-xs text-muted-foreground">{row.snapshot.email}</p></TableCell><TableCell>{row.snapshot.due_date?.split("-").reverse().join("/") ?? "—"}</TableCell><TableCell>{money.format(row.snapshot.value)}</TableCell><TableCell>{collectionPaymentMethod(row.snapshot.billing_type)}</TableCell><TableCell>{row.snapshot.status}</TableCell><TableCell>{row.snapshot.stage ?? "Sem envio hoje"}{blocked && <p className="text-xs text-amber-700 dark:text-amber-300">{blocked}</p>}{!!row.snapshot.warnings.length && <p className="text-xs text-amber-700 dark:text-amber-300">{row.snapshot.warnings.join(" · ")}</p>}</TableCell></TableRow>})}{!filtered.length && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Nenhum registro neste relatório ou filtro.</TableCell></TableRow>}</TableBody></Table>
      {filtered.length > 50 && <div className="flex items-center gap-3"><Button variant="outline" disabled={page===0} onClick={() => setPage(page-1)}>Anterior</Button><span className="text-sm">Página {page+1} de {Math.ceil(filtered.length/50)}</span><Button variant="outline" disabled={(page+1)*50>=filtered.length} onClick={() => setPage(page+1)}>Próxima</Button></div>}</>}
      {detail && <div className="space-y-2 rounded-xl border p-4 text-sm"><div className="flex justify-between"><h3 className="font-medium">{detail.snapshot.name}</h3><Button variant="ghost" size="sm" onClick={() => setDetail(null)}>Fechar</Button></div><p>{detail.snapshot.description}</p><p>{detail.snapshot.phone} · {detail.snapshot.payment_id}</p>{[detail.snapshot.invoice_url,detail.snapshot.bankslip_url].filter((url): url is string => Boolean(url && /^https:\/\//.test(url))).map((url,index) => <a key={index} className="mr-4 inline-block underline" href={url} target="_blank" rel="noreferrer">{index===0 ? "Abrir fatura" : "Abrir boleto"}</a>)}{detail.snapshot.pix_payload && <label className="block">Pix copia e cola<textarea readOnly className="mt-1 w-full rounded border bg-card p-2" value={detail.snapshot.pix_payload} /></label>}</div>}
    </>}
  </section>;
}
