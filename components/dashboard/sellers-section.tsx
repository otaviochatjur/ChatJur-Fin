"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { money, type ActorMetrics, type CommercialActor } from "@/lib/metrics";

export function SellersSection({ actors, metrics, onChanged }: { actors: CommercialActor[]; metrics: Record<string, ActorMetrics>; onChanged: () => void }) {
  const sellers = actors.filter((actor) => actor.role === "EXTERNAL_SALES");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  async function addSeller() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const response = await fetch("/api/commercial-actors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed, role: "EXTERNAL_SALES", email: email.trim() || undefined }) });
    const data = await response.json();
    if (!response.ok) { toast.error(data.error ?? "Não foi possível cadastrar."); return; }
    toast.success("Comercial cadastrado.");
    setName(""); setEmail(""); setOpen(false);
    onChanged();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div><h2 className="font-semibold">Equipe comercial externa</h2><p className="mt-1 text-sm text-slate-500">Vendedores independentes sem vínculo de parceiro ou preço especial</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="bg-[#123a2e] text-white hover:bg-[#0d2c23]"><Plus className="size-4" />Novo comercial</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Cadastrar comercial externo</DialogTitle><DialogDescription>O comercial poderá receber atribuição de leads, contratos e MRR.</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome completo" />
              <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail (opcional)" type="email" />
            </div>
            <DialogFooter><Button onClick={addSeller}>Cadastrar comercial</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Comercial</TableHead><TableHead>Contato</TableHead><TableHead className="text-right">Links ativos</TableHead><TableHead className="text-right">Clientes</TableHead><TableHead className="text-right">MRR atribuído</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          {sellers.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-slate-500">Nenhum comercial externo cadastrado ainda.</TableCell></TableRow>}
          {sellers.map((seller) => {
            const sellerMetrics = metrics[seller.id] ?? { clients: 0, mrr: 0, links: 0 };
            return (
              <TableRow key={seller.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="grid size-9 place-items-center rounded-full bg-slate-100 font-medium text-slate-600">{seller.name.slice(0, 1)}</div>
                    <div><p className="font-medium">{seller.name}</p><p className="text-xs text-slate-500">Comercial externo</p></div>
                  </div>
                </TableCell>
                <TableCell className="text-slate-500">{seller.email ?? "—"}</TableCell>
                <TableCell className="text-right">{sellerMetrics.links}</TableCell>
                <TableCell className="text-right">{sellerMetrics.clients}</TableCell>
                <TableCell className="text-right font-medium">{money.format(sellerMetrics.mrr)}</TableCell>
                <TableCell><StatusBadge status={seller.status} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
