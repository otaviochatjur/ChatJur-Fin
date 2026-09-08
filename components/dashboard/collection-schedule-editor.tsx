"use client";
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DEFAULT_SCHEDULE, type CollectionScheduleConfig } from '@/lib/collection-schedule';
import type { ScheduleJob } from '@/lib/collection-schedule-server';
export function CollectionScheduleEditor() {
  const [config, setConfig] = useState<CollectionScheduleConfig>({ ...DEFAULT_SCHEDULE });
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    let stopped = false;
    fetch('/api/collections/schedule').then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!stopped) { setConfig(data.config); setJobs(data.jobs); setLoaded(true); } }).catch(error => { if (!stopped) setMessage(error.message); });
    const interval = setInterval(() => {
      fetch('/api/collections/schedule').then(async response => { const data = await response.json(); if (response.ok && !stopped) setJobs(data.jobs); }).catch(() => undefined);
    }, 15000);
    return () => { stopped = true; clearInterval(interval); };
  }, []);
  async function save() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/collections/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setMessage(config.enabled ? 'Programação ativada e salva.' : 'Programação desativada e salva.');
      window.dispatchEvent(new Event('nexo:programming-changed'));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao salvar.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-5 rounded-2xl bg-card p-5">
    <div><h2 className="font-semibold">Programação de cobranças</h2><p className="mt-1 text-sm text-muted-foreground">Uma execução por dia, para cobranças aptas na régua e nos templates definidos por cliente ou categoria.</p></div>
    <fieldset disabled={!loaded || busy} className="space-y-4">
      <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={config.enabled} onChange={event => setConfig({ ...config, enabled: event.target.checked })} />Ativar envios automáticos</label>
      <label className="block text-sm">Horário de Brasília<input type="time" required value={config.time} onChange={event => setConfig({ ...config, time: event.target.value })} className="mt-1 block rounded-lg border bg-background px-3 py-2" /></label>
      <div className="flex flex-wrap gap-5">{([['saturday','Enviar aos sábados'],['sunday','Enviar aos domingos'],['holidays','Enviar em feriados nacionais']] as const).map(([key,label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config[key]} onChange={event => setConfig({ ...config, [key]: event.target.checked })} />{label}</label>)}</div>
      <p className="text-sm text-muted-foreground">Estas opções valem para os envios programados. Dias desmarcados transferem a etapa para o próximo dia permitido. Se um feriado cair no fim de semana, ambas as opções precisam estar marcadas.</p>
      <div className="rounded-xl bg-muted/50 p-3 text-sm">Execução local: mantenha o sistema aberto, com sessão ativa e computador conectado. O lote começa no horário escolhido ou ao abrir o sistema depois dele, no mesmo dia. Dias anteriores não são recuperados. Ao desativar, um envio já em andamento pode terminar.</div>
      <Button onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar programação'}</Button>
    </fieldset>
    {message && <p role="status" className="text-sm">{message}</p>}
    <div className="space-y-2"><h3 className="text-sm font-medium">Últimas execuções</h3>{!jobs.length && <p className="text-sm text-muted-foreground">Nenhuma execução programada registrada.</p>}{jobs.map(job => <div key={job.run_date} className="rounded-lg bg-muted/30 p-3 text-sm"><p>{job.run_date.split('-').reverse().join('/')} · {job.status === 'COMPLETE' ? 'Concluída' : job.status === 'RUNNING' ? 'Em andamento' : 'Requer revisão'} · {job.sent} enviados · {job.skipped} ignorados</p>{job.error && <p className="mt-1 text-destructive">{job.error} Use o envio manual após conferir o histórico; esta execução não será repetida automaticamente.</p>}</div>)}</div>
  </section>;
}
