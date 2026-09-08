"use client";
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { type ConnectLead, roleLabels } from '@/lib/metrics';
import { connectLeadAnswers } from '@/lib/connect-lead-details';
const labels = { PENDING: 'Pendentes', APPROVED: 'Aprovadas', REJECTED: 'Reprovadas', ALL: 'Todas' };
const roles = ['PARTNER', 'AMBASSADOR', 'INSTITUTIONAL'] as const;
export function ConnectLeadsSection({ leads, onChanged }: { leads: ConnectLead[]; onChanged: () => void }) {
  const [filter, setFilter] = useState<keyof typeof labels>('PENDING');
  const [target, setTarget] = useState<ConnectLead | null>(null);
  const [role, setRole] = useState<typeof roles[number]>('PARTNER');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  async function decide(action: 'APPROVE' | 'REJECT') {
    if (!target || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/connect-leads', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: target.id, action, classifiedAs: role, reviewedNotes: notes }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível registrar a decisão.');
      toast.success(action === 'APPROVE' ? 'Candidatura aprovada e cadastro criado.' : 'Candidatura reprovada.');
      setTarget(null); onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao salvar a revisão.'); }
    finally { setBusy(false); }
  }
  const filtered = leads.filter(lead => filter === 'ALL' || lead.status === filter);
  return <div className="space-y-4">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">Candidaturas</h2><p className="text-sm text-muted-foreground">Abra uma candidatura para ler todas as respostas e registrar sua decisão.</p></div>
      <div className="flex flex-wrap gap-1">{(Object.keys(labels) as (keyof typeof labels)[]).map(status => <Button key={status} size="sm" variant={status === filter ? 'default' : 'ghost'} onClick={() => setFilter(status)}>{labels[status]} {status === 'PENDING' ? `(${leads.filter(l => l.status === 'PENDING').length})` : ''}</Button>)}</div></div>
    {!filtered.length && <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma candidatura nesta seleção.</p>}
    <div className="space-y-2">{filtered.map(lead => <button key={lead.id} onClick={() => { setTarget(lead); setNotes(lead.reviewed_notes ?? ''); setRole(lead.classified_as ?? 'PARTNER'); }} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4 text-left shadow-sm transition hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary">
      <div><p className="font-medium">{lead.full_name ?? 'Sem nome'}</p><p className="text-sm text-muted-foreground">{lead.email ?? lead.whatsapp ?? 'Contato não informado'}</p></div><div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{new Date(lead.submitted_at ?? lead.created_at).toLocaleDateString('pt-BR')}</span><Badge variant="outline">{labels[lead.status]}</Badge><span className="text-sm text-primary">Analisar →</span></div>
    </button>)}</div>
    <Dialog open={!!target} onOpenChange={open => { if (!open && !busy) setTarget(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{target?.full_name ?? 'Candidatura'}</DialogTitle><DialogDescription>Respostas completas do formulário e revisão interna.</DialogDescription></DialogHeader>
      {target && <><dl className="space-y-5">{connectLeadAnswers(target).map((answer, index) => <div key={index} className="space-y-1"><dt className="text-sm font-medium text-muted-foreground">{answer.label}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-relaxed">{answer.value}</dd></div>)}</dl>
      <div className="mt-4 space-y-3 rounded-xl bg-muted/40 p-4"><h3 className="font-medium">Decisão</h3>{target.status === 'PENDING' ? <>
        <label className="block text-sm">Aprovar como<select aria-label="Classificação da candidatura" value={role} onChange={event => setRole(event.target.value as typeof role)} disabled={busy} className="mt-1 block w-full rounded-lg border bg-background p-2">{roles.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></label>
        <Textarea aria-label="Observações da revisão" value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} placeholder="Observações internas (opcional)" />
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => void decide('REJECT')}>Reprovar</Button><Button disabled={busy} onClick={() => void decide('APPROVE')}>{busy ? 'Salvando…' : `Aprovar como ${roleLabels[role]}`}</Button></div>
      </> : <><p className="text-sm">{labels[target.status]}{target.classified_as ? ` · ${roleLabels[target.classified_as]}` : ''}</p><p className="whitespace-pre-wrap text-sm">{target.reviewed_notes ?? 'Sem observações.'}</p>{target.reviewed_at && <p className="text-xs text-muted-foreground">Revisada em {new Date(target.reviewed_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>}</>}</div></>}
    </DialogContent></Dialog>
  </div>;
}
