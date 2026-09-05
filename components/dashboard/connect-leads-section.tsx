"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type ConnectLead, roleLabels } from "@/lib/metrics";

const statusFilters = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;
const statusLabels: Record<(typeof statusFilters)[number], string> = { PENDING: "Pendentes", APPROVED: "Aprovadas", REJECTED: "Reprovadas", ALL: "Todas" };
const classifications = ["PARTNER", "AMBASSADOR", "INSTITUTIONAL"] as const;

function socialLinks(lead: ConnectLead) {
  return [
    lead.instagram && { label: "Instagram", value: lead.instagram },
    lead.linkedin && { label: "LinkedIn", value: lead.linkedin },
    lead.youtube && { label: "YouTube", value: lead.youtube },
    lead.tiktok && { label: "TikTok", value: lead.tiktok },
    lead.twitter_x && { label: "X/Twitter", value: lead.twitter_x },
    lead.website && { label: "Site", value: lead.website },
  ].filter((item): item is { label: string; value: string } => Boolean(item));
}

/**
 * Review/classification screen for candidacies submitted through the
 * public Chat Jurídico Connect form (see app/api/webhooks/tally). The form
 * doesn't ask the candidate to pick a category — that happens here, when
 * approving.
 */
export function ConnectLeadsSection({ leads, onChanged }: { leads: ConnectLead[]; onChanged: () => void }) {
  const [statusFilter, setStatusFilter] = useState<(typeof statusFilters)[number]>("PENDING");
  const [approveTarget, setApproveTarget] = useState<ConnectLead | null>(null);
  const [approveAs, setApproveAs] = useState<(typeof classifications)[number]>("PARTNER");
  const [rejectTarget, setRejectTarget] = useState<ConnectLead | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = statusFilter === "ALL" ? leads : leads.filter((lead) => lead.status === statusFilter);

  async function approve() {
    if (!approveTarget) return;
    setBusy(true);
    try {
      const response = await fetch("/api/connect-leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: approveTarget.id, action: "APPROVE", classifiedAs: approveAs, reviewedNotes: reviewNotes }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível aprovar a candidatura."); return; }
      toast.success(`Candidatura aprovada como ${roleLabels[approveAs]} — cadastro criado.`);
      setApproveTarget(null); setReviewNotes("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!rejectTarget) return;
    setBusy(true);
    try {
      const response = await fetch("/api/connect-leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rejectTarget.id, action: "REJECT", reviewedNotes: reviewNotes }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível reprovar a candidatura."); return; }
      toast.success("Candidatura reprovada.");
      setRejectTarget(null); setReviewNotes("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Candidaturas do Chat Jurídico Connect</h2><p className="mt-1 text-sm text-slate-500">Respostas do formulário público — classifique manualmente cada candidato</p></div>
        <div className="flex gap-1.5 rounded-full bg-slate-100 p-1">
          {statusFilters.map((status) => (
            <button key={status} onClick={() => setStatusFilter(status)} className={`rounded-full px-3 py-1 text-xs font-medium transition ${statusFilter === status ? "bg-white text-[#3a5d9d] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {statusLabels[status]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Nenhuma candidatura {statusFilter !== "ALL" ? statusLabels[statusFilter].toLowerCase() : ""} por aqui ainda.</p>}

      <div className="space-y-3">
        {filtered.map((lead) => {
          const socials = socialLinks(lead);
          return (
            <div key={lead.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{lead.full_name ?? "Sem nome"}</p>
                    {lead.applicant_type && <Badge variant="outline">{lead.applicant_type}</Badge>}
                    {lead.status === "APPROVED" && <Badge className="bg-[#3b82f6]">Aprovada como {lead.classified_as ? roleLabels[lead.classified_as] : "—"}</Badge>}
                    {lead.status === "REJECTED" && <Badge variant="outline" className="text-red-600">Reprovada</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{[lead.email, lead.whatsapp].filter(Boolean).join(" · ") || "Sem contato informado"}</p>
                  <p className="mt-1 text-xs text-slate-400">Recebida em {new Date(lead.created_at).toLocaleDateString("pt-BR")}</p>
                </div>
                {lead.status === "PENDING" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setRejectTarget(lead); setReviewNotes(""); }}>Reprovar</Button>
                    <Button size="sm" className="bg-[#3a5d9d] text-white hover:bg-[#2c4a80]" onClick={() => { setApproveTarget(lead); setApproveAs("PARTNER"); setReviewNotes(""); }}>Aprovar como…</Button>
                  </div>
                )}
              </div>

              {socials.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {socials.map((social) => <Badge key={social.label} variant="outline" className="text-xs">{social.label}: {social.value}</Badge>)}
                </div>
              )}

              {(lead.main_channel_audience_size || lead.office_network_size) && (
                <p className="mt-2 text-xs text-slate-500">Alcance: {[lead.main_channel && `${lead.main_channel} (${lead.main_channel_audience_size ?? "?"})`, lead.office_network_size && `rede de escritórios: ${lead.office_network_size}`].filter(Boolean).join(" · ")}</p>
              )}

              {(lead.motivation_why || lead.motivation_success_view) && (
                <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
                  {lead.motivation_why && <p><span className="font-medium">Por que quer participar: </span>{lead.motivation_why}</p>}
                  {lead.motivation_success_view && <p><span className="font-medium">Parceria de sucesso: </span>{lead.motivation_success_view}</p>}
                </div>
              )}

              {lead.reviewed_notes && <p className="mt-2 text-xs text-slate-500">Observações da revisão: {lead.reviewed_notes}</p>}
            </div>
          );
        })}
      </div>

      <Dialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar candidatura de {approveTarget?.full_name ?? "candidato"}</DialogTitle>
            <DialogDescription>Cria automaticamente o cadastro em Chat Jurídico Connect com os dados da candidatura.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={approveAs} onValueChange={(value) => setApproveAs(value as typeof approveAs)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {classifications.map((option) => <SelectItem key={option} value={option}>{roleLabels[option]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Observações internas (opcional)" />
          </div>
          <DialogFooter><Button disabled={busy} onClick={approve} className="bg-[#3a5d9d] text-white hover:bg-[#2c4a80]">{busy ? "Aprovando…" : `Aprovar como ${roleLabels[approveAs]}`}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reprovar candidatura de {rejectTarget?.full_name ?? "candidato"}</DialogTitle>
            <DialogDescription>A candidatura fica registrada como reprovada — nenhum cadastro é criado.</DialogDescription>
          </DialogHeader>
          <Textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Motivo (opcional)" />
          <DialogFooter><Button disabled={busy} variant="outline" onClick={reject}>{busy ? "Reprovando…" : "Confirmar reprovação"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
