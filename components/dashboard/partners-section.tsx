"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Copy, Link2, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { money, roleLabels, type ActorMetrics, type CommercialActor, type PaymentLink, type Plan, type PriceVersion } from "@/lib/metrics";

export function PartnersSection({ actors, metrics, plans, onChanged }: { actors: CommercialActor[]; metrics: Record<string, ActorMetrics>; plans: Plan[]; onChanged: () => void }) {
  const partners = actors.filter((actor) => actor.role === "PARTNER" || actor.role === "AMBASSADOR");
  const [selectedIdRaw, setSelectedId] = useState<string>("");
  // Derive the effective selection at render time instead of syncing it
  // back into state via an effect (avoids react-hooks/set-state-in-effect
  // and matches "you might not need an effect" guidance).
  const selectedId = selectedIdRaw && partners.some((partner) => partner.id === selectedIdRaw) ? selectedIdRaw : partners[0]?.id ?? "";
  const [priceVersions, setPriceVersions] = useState<PriceVersion[]>([]);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [savingPrices, setSavingPrices] = useState(false);
  const [newPartnerName, setNewPartnerName] = useState("");
  const [newPartnerRole, setNewPartnerRole] = useState<"PARTNER" | "AMBASSADOR">("PARTNER");
  const [partnerDialog, setPartnerDialog] = useState(false);
  const [linkDialog, setLinkDialog] = useState(false);
  const [linkPlanIdRaw, setLinkPlanId] = useState("");
  const linkPlanId = linkPlanIdRaw || plans[0]?.id || "";
  const [linkStatus, setLinkStatus] = useState("");
  const [creatingLink, setCreatingLink] = useState(false);

  async function loadDetail(actorId: string) {
    const [priceRes, linkRes] = await Promise.all([fetch(`/api/price-versions?actorId=${actorId}`), fetch(`/api/asaas/payment-links?actorId=${actorId}`)]);
    const [priceData, linkData] = await Promise.all([priceRes.json(), linkRes.json()]);
    const versions: PriceVersion[] = priceRes.ok ? priceData.priceVersions ?? [] : [];
    // Every setState call below happens after the awaits above, so this is
    // not a synchronous effect update — known limitation of the static
    // analysis behind react-hooks/set-state-in-effect (facebook/react#34905).
    setPriceVersions(versions);
    setLinks(linkRes.ok ? linkData.links ?? [] : []);
    setPrices(Object.fromEntries(plans.map((plan) => {
      const current = versions.find((version) => version.plan_id === plan.id && version.effective_until === null);
      return [plan.id, String(current ? current.value : plan.standard_value)];
    })));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadDetail only calls setState after its internal awaits resolve.
    if (selectedId) loadDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes the freshly-defined loadDetail function identity; plans/selectedId already capture its reactive inputs.
  }, [selectedId, plans]);

  const currentPartner = partners.find((partner) => partner.id === selectedId);
  const currentMetrics = currentPartner ? metrics[currentPartner.id] ?? { clients: 0, mrr: 0, links: 0 } : { clients: 0, mrr: 0, links: 0 };

  async function addPartner() {
    const name = newPartnerName.trim();
    if (!name) return;
    const response = await fetch("/api/commercial-actors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, role: newPartnerRole }) });
    const data = await response.json();
    if (!response.ok) { toast.error(data.error ?? "Não foi possível cadastrar."); return; }
    toast.success("Parceiro cadastrado.");
    setNewPartnerName(""); setPartnerDialog(false); setSelectedId(data.actor.id);
    onChanged();
  }

  async function savePrices() {
    if (!currentPartner) return;
    setSavingPrices(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const results = await Promise.all(plans.map(async (plan) => {
        const value = Number(prices[plan.id]);
        if (!Number.isFinite(value) || value <= 0) return { ok: true };
        const response = await fetch("/api/price-versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actorId: currentPartner.id, planId: plan.id, value, effectiveFrom: today, changeReason: "Atualização manual via painel" }),
        });
        return { ok: response.ok, data: await response.json() };
      }));
      const failed = results.find((result) => !result.ok);
      if (failed) { toast.error("Alguns preços não foram salvos."); return; }
      toast.success("Nova tabela de preços salva.");
      await loadDetail(currentPartner.id);
    } finally {
      setSavingPrices(false);
    }
  }

  async function generateLink() {
    if (!currentPartner) return;
    const plan = plans.find((item) => item.id === linkPlanId);
    if (!plan) return;
    setCreatingLink(true); setLinkStatus("");
    try {
      const value = Number(prices[plan.id] ?? plan.standard_value);
      const response = await fetch("/api/asaas/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: currentPartner.id, partnerName: currentPartner.name, planId: plan.id, planName: plan.name, billingPeriod: plan.billing_period, priceVersion: "V1", value }),
      });
      const data = await response.json();
      if (!response.ok) { setLinkStatus(data.error ?? "Não foi possível gerar o link."); return; }
      toast.success("Link gerado no Asaas.");
      setLinkDialog(false);
      await loadDetail(currentPartner.id);
      onChanged();
    } finally {
      setCreatingLink(false);
    }
  }

  function copyLink(url: string | null) {
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado.");
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(390px,0.7fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div><h2 className="font-semibold">Parceiros cadastrados</h2><p className="mt-1 text-sm text-slate-500">Preços próprios, links e clientes originados</p></div>
          <Dialog open={partnerDialog} onOpenChange={setPartnerDialog}>
            <DialogTrigger asChild><Button className="bg-[#123a2e] text-white hover:bg-[#0d2c23]"><Plus className="size-4" />Novo parceiro</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Cadastrar parceiro</DialogTitle><DialogDescription>Depois do cadastro, você poderá definir preços e gerar links.</DialogDescription></DialogHeader>
              <div className="space-y-3">
                <Input value={newPartnerName} onChange={(event) => setNewPartnerName(event.target.value)} placeholder="Nome do parceiro ou organização" />
                <Select value={newPartnerRole} onValueChange={(value) => setNewPartnerRole(value as "PARTNER" | "AMBASSADOR")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="PARTNER">Parceiro</SelectItem><SelectItem value="AMBASSADOR">Embaixador</SelectItem></SelectContent>
                </Select>
              </div>
              <DialogFooter><Button onClick={addPartner}>Cadastrar parceiro</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Parceiro</TableHead><TableHead className="text-right">Clientes</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-right">Links</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {partners.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-slate-500">Nenhum parceiro cadastrado ainda.</TableCell></TableRow>}
            {partners.map((partner) => {
              const partnerMetrics = metrics[partner.id] ?? { clients: 0, mrr: 0, links: 0 };
              return (
                <TableRow key={partner.id} className={partner.id === selectedId ? "bg-[#f3faf6]" : ""}>
                  <TableCell><button onClick={() => setSelectedId(partner.id)} className="text-left"><p className="font-medium">{partner.name}</p><p className="text-xs text-slate-500">{roleLabels[partner.role]}</p></button></TableCell>
                  <TableCell className="text-right">{partnerMetrics.clients}</TableCell>
                  <TableCell className="text-right font-medium">{money.format(partnerMetrics.mrr)}</TableCell>
                  <TableCell className="text-right">{partnerMetrics.links}</TableCell>
                  <TableCell><StatusBadge status={partner.status} /></TableCell>
                  <TableCell><Button onClick={() => setSelectedId(partner.id)} variant="ghost" size="icon"><ChevronRight className="size-4" /><span className="sr-only">Abrir parceiro</span></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        {!currentPartner ? <p className="text-sm text-slate-500">Cadastre um parceiro para ver preços e links.</p> : <>
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-[#167354]">Parceiro selecionado</p><h2 className="mt-2 text-lg font-semibold">{currentPartner.name}</h2><p className="text-sm text-slate-500">Tabela própria e links Asaas</p></div>
            <Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>
          </div>
          <Tabs defaultValue="prices" className="mt-5">
            <TabsList className="grid w-full grid-cols-3"><TabsTrigger value="prices">Preços</TabsTrigger><TabsTrigger value="links">Links</TabsTrigger><TabsTrigger value="performance">Resultado</TabsTrigger></TabsList>
            <TabsContent value="prices" className="mt-4 space-y-3">
              {plans.map((plan) => (
                <div key={plan.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div><p className="text-sm font-medium">{plan.name}</p><p className="text-xs text-slate-500">{plan.billing_period === "ANNUAL" ? "Anual · contrato de 12 meses" : "Mensal"}</p></div>
                    <Badge variant="outline">Tabela: {money.format(plan.standard_value)}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-sm text-slate-500">R$</span>
                    <Input type="number" step="0.01" value={prices[plan.id] ?? ""} onChange={(event) => setPrices((current) => ({ ...current, [plan.id]: event.target.value }))} />
                    {plan.billing_period === "ANNUAL" && <span className="whitespace-nowrap text-xs text-slate-500">até {plan.annual_installment_limit ?? 6}x</span>}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-slate-500">{priceVersions.find((version) => version.effective_until === null) ? `Vigente desde ${new Date(priceVersions.find((version) => version.effective_until === null)!.effective_from).toLocaleDateString("pt-BR")}` : "Usando tabela padrão dos planos"}</p>
                <Button disabled={savingPrices} onClick={savePrices} variant="outline">{savingPrices ? "Salvando…" : "Salvar nova versão"}</Button>
              </div>
            </TabsContent>
            <TabsContent value="links" className="mt-4 space-y-3">
              {links.length === 0 && <p className="text-sm text-slate-500">Nenhum link gerado para este parceiro ainda.</p>}
              {links.map((link) => (
                <div key={link.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <div><p className="text-sm font-medium">{link.display_name}</p><p className="text-xs text-slate-500">{link.billing_period === "ANNUAL" ? "Anual" : "Mensal"} · {money.format(link.value)}</p></div>
                  <Button onClick={() => copyLink(link.url)} variant="ghost" size="icon"><Copy className="size-4" /></Button>
                </div>
              ))}
              <Dialog open={linkDialog} onOpenChange={setLinkDialog}>
                <DialogTrigger asChild><Button className="w-full bg-[#123a2e] text-white hover:bg-[#0d2c23]"><Link2 className="size-4" />Gerar link no Asaas</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Gerar link de pagamento</DialogTitle><DialogDescription>O link será identificado com parceiro, plano e versão de preço.</DialogDescription></DialogHeader>
                  <Select value={linkPlanId} onValueChange={setLinkPlanId}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name} · {plan.billing_period === "ANNUAL" ? "Anual" : "Mensal"}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="text-slate-500">Valor que será enviado ao Asaas</p><p className="mt-1 font-semibold">{money.format(Number(prices[linkPlanId] ?? 0))}</p></div>
                  {linkStatus && <p role="alert" className="text-sm text-red-600">{linkStatus}</p>}
                  <DialogFooter><Button disabled={creatingLink} onClick={generateLink}>{creatingLink ? "Gerando…" : "Gerar link"}</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </TabsContent>
            <TabsContent value="performance" className="mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Clientes</p><p className="mt-1 text-xl font-semibold">{currentMetrics.clients}</p></div>
                <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">MRR</p><p className="mt-1 text-xl font-semibold">{money.format(currentMetrics.mrr)}</p></div>
              </div>
            </TabsContent>
          </Tabs>
        </>}
      </section>
    </div>
  );
}
