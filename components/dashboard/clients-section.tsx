"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CommercialActor, CustomerAttribution } from "@/lib/metrics";

export function ClientsSection({ actors, attributions, onCreated }: { actors: CommercialActor[]; attributions: CustomerAttribution[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [partnerActorId, setPartnerActorId] = useState<string>("none");
  const [externalActorId, setExternalActorId] = useState<string>("none");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const actorName = (id: string | null) => actors.find((actor) => actor.id === id)?.name ?? "—";
  const partners = actors.filter((actor) => actor.role === "PARTNER" || actor.role === "AMBASSADOR");
  const sellers = actors.filter((actor) => actor.role === "EXTERNAL_SALES");

  async function createAttribution() {
    setFormError("");
    if (!customerId.trim() || (partnerActorId === "none" && externalActorId === "none")) {
      setFormError("Informe o cliente e ao menos um responsável.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/customer-attributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerExternalId: customerId.trim(), partnerActorId: partnerActorId === "none" ? undefined : partnerActorId, externalSalesActorId: externalActorId === "none" ? undefined : externalActorId }),
      });
      const data = await response.json();
      if (!response.ok) { setFormError(data.error ?? "Não foi possível salvar."); return; }
      toast.success("Cliente atribuído com sucesso.");
      setCustomerId(""); setPartnerActorId("none"); setExternalActorId("none"); setOpen(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <h2 className="font-semibold">Clientes atribuídos</h2>
          <p className="mt-1 text-sm text-slate-500">Origem comercial de cada cliente, preservada em customer_attributions</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="bg-[#123a2e] text-white hover:bg-[#0d2c23]"><Plus className="size-4" />Atribuir cliente</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Atribuir cliente</DialogTitle><DialogDescription>Vincule o identificador externo do cliente a um parceiro e/ou comercial.</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <Input value={customerId} onChange={(event) => setCustomerId(event.target.value)} placeholder="ID externo do cliente (ex.: CRM-1234)" />
              <Select value={partnerActorId} onValueChange={setPartnerActorId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Parceiro / embaixador" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Sem parceiro</SelectItem>{partners.map((actor) => <SelectItem key={actor.id} value={actor.id}>{actor.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={externalActorId} onValueChange={setExternalActorId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Comercial externo" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Sem comercial externo</SelectItem>{sellers.map((actor) => <SelectItem key={actor.id} value={actor.id}>{actor.name}</SelectItem>)}</SelectContent>
              </Select>
              {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            </div>
            <DialogFooter><Button disabled={saving} onClick={createAttribution}>{saving ? "Salvando…" : "Salvar atribuição"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Parceiro</TableHead><TableHead>Comercial externo</TableHead><TableHead>Atribuído em</TableHead></TableRow></TableHeader>
        <TableBody>
          {attributions.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-slate-500">Nenhum cliente atribuído ainda.</TableCell></TableRow>}
          {attributions.map((attribution) => (
            <TableRow key={attribution.id}>
              <TableCell className="font-medium">{attribution.customer_external_id}</TableCell>
              <TableCell>{actorName(attribution.partner_actor_id)}</TableCell>
              <TableCell>{actorName(attribution.external_sales_actor_id)}</TableCell>
              <TableCell className="text-slate-500">{new Date(attribution.attributed_at).toLocaleDateString("pt-BR")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
