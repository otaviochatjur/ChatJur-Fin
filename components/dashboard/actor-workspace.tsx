"use client";

import { useEffect, useState } from "react";
import { Copy, Link2, MoreHorizontal, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { actorCategoryLabel, connectDefaultRatePercent, connectRoles, CONNECT_PLUS_ELIGIBILITY_CLIENTS, money, roleLabels, type ActorCustomPlan, type ActorMetrics, type CommercialActor, type CommissionRate, type PaymentLink, type Plan, type PriceVersion } from "@/lib/metrics";

type BillingPeriod = "MONTHLY" | "ANNUAL";

/** Unified shape covering both catalog plans and this actor's own custom plans, used to drive the Links tab. */
type LinkCandidate = {
  key: string;
  planId: string | null;
  customPlanId: string | null;
  name: string;
  billingPeriod: BillingPeriod;
  value: number;
  maxInstallments: number | null;
};

const MIN_INSTALLMENTS = 1;
const MAX_INSTALLMENTS = 12;

function clampInstallments(raw: unknown, fallback = 6) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(MAX_INSTALLMENTS, Math.max(MIN_INSTALLMENTS, Math.round(num)));
}

/**
 * Detail workspace for a single commercial actor (partner, ambassador or
 * external seller): editable price table (catalog + per-actor custom plans)
 * and bulk Asaas link generation. Mount with `key={actor.id}` so state
 * resets cleanly when the selection changes, instead of syncing it back via
 * an effect.
 */
export function ActorWorkspace({ actor, plans, metrics, onChanged }: { actor: CommercialActor; plans: Plan[]; metrics: ActorMetrics; onChanged: () => void }) {
  const [priceVersions, setPriceVersions] = useState<PriceVersion[]>([]);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [customPlans, setCustomPlans] = useState<ActorCustomPlan[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [installments, setInstallments] = useState<Record<string, string>>({});
  const [customEdits, setCustomEdits] = useState<Record<string, { value: string; maxInstallments: string }>>({});
  const [savingPrices, setSavingPrices] = useState(false);
  const [deselectedKeys, setDeselectedKeys] = useState<Set<string>>(new Set());
  const [creatingLinks, setCreatingLinks] = useState(false);
  const [linkStatus, setLinkStatus] = useState("");

  const [customDialog, setCustomDialog] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customBillingPeriod, setCustomBillingPeriod] = useState<BillingPeriod>("MONTHLY");
  const [customValue, setCustomValue] = useState("");
  const [customInstallments, setCustomInstallments] = useState("6");
  const [creatingCustomPlan, setCreatingCustomPlan] = useState(false);
  const [syncingPayments, setSyncingPayments] = useState(false);

  const [commissionRates, setCommissionRates] = useState<CommissionRate[]>([]);
  const [commissionEdits, setCommissionEdits] = useState<Record<string, string>>({});
  const [savingCommission, setSavingCommission] = useState(false);
  const canEarnCommission = actor.role !== "INTERNAL_SALES";

  // "Dados" tab (personal + banking info + tier + redes sociais).
  // Initialized straight from the `actor` prop — this component is mounted
  // with `key={actor.id}`, so switching actors remounts it and these reset
  // cleanly, no effect needed.
  const [profileEmail, setProfileEmail] = useState(actor.email ?? "");
  const [profilePhone, setProfilePhone] = useState(actor.phone ?? "");
  const [profileDocument, setProfileDocument] = useState(actor.document ?? "");
  const [profileNotes, setProfileNotes] = useState(actor.notes ?? "");
  const [profilePixKey, setProfilePixKey] = useState(actor.pix_key ?? "");
  const [profileBankName, setProfileBankName] = useState(actor.bank_name ?? "");
  const [profileBankAgency, setProfileBankAgency] = useState(actor.bank_agency ?? "");
  const [profileBankAccount, setProfileBankAccount] = useState(actor.bank_account ?? "");
  const [profileBankAccountType, setProfileBankAccountType] = useState<"CORRENTE" | "POUPANCA" | "NONE">(actor.bank_account_type ?? "NONE");
  const [profileBankNotes, setProfileBankNotes] = useState(actor.bank_notes ?? "");
  const [profileTier, setProfileTier] = useState<"STANDARD" | "PLUS">(actor.tier ?? "STANDARD");
  const [profileRole, setProfileRole] = useState<CommercialActor["role"]>(actor.role);
  const [profileInstagram, setProfileInstagram] = useState(actor.instagram ?? "");
  const [profileLinkedin, setProfileLinkedin] = useState(actor.linkedin ?? "");
  const [profileYoutube, setProfileYoutube] = useState(actor.youtube ?? "");
  const [profileTiktok, setProfileTiktok] = useState(actor.tiktok ?? "");
  const [profileTwitterX, setProfileTwitterX] = useState(actor.twitter_x ?? "");
  const [profileWebsite, setProfileWebsite] = useState(actor.website ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const response = await fetch("/api/commercial-actors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: actor.id,
          ...(profileRole !== actor.role ? { role: profileRole } : {}),
          email: profileEmail.trim() || null,
          phone: profilePhone.trim() || null,
          notes: profileNotes.trim() || null,
          document: profileDocument.trim() || null,
          pixKey: profilePixKey.trim() || null,
          bankName: profileBankName.trim() || null,
          bankAgency: profileBankAgency.trim() || null,
          bankAccount: profileBankAccount.trim() || null,
          bankAccountType: profileBankAccountType === "NONE" ? null : profileBankAccountType,
          bankNotes: profileBankNotes.trim() || null,
          ...(profileRole === "PARTNER" ? { tier: profileTier } : {}),
          instagram: profileInstagram.trim() || null,
          linkedin: profileLinkedin.trim() || null,
          youtube: profileYoutube.trim() || null,
          tiktok: profileTiktok.trim() || null,
          twitterX: profileTwitterX.trim() || null,
          website: profileWebsite.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível salvar os dados."); return; }
      toast.success("Dados atualizados.");
      onChanged();
    } finally {
      setSavingProfile(false);
    }
  }

  /** Resets the actor's default repasse rate to the official Connect category % (Parceiro 10 / Plus 15 / Embaixador 15 / Institucional 10). Per-plan overrides are untouched. */
  async function applyDefaultCommissionRate() {
    const rate = connectDefaultRatePercent(actor.role, actor.tier);
    if (rate === null) return;
    const response = await fetch("/api/commission-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: actor.id, planId: null, customPlanId: null, ratePercent: rate }),
    });
    if (!response.ok) { toast.error("Não foi possível aplicar a taxa padrão."); return; }
    toast.success(`Taxa padrão da categoria aplicada (${rate}%).`);
    await loadDetail();
  }

  async function loadDetail() {
    const [priceRes, linkRes, customRes, commissionRes] = await Promise.all([
      fetch(`/api/price-versions?actorId=${actor.id}`),
      fetch(`/api/asaas/payment-links?actorId=${actor.id}`),
      fetch(`/api/actor-custom-plans?actorId=${actor.id}`),
      canEarnCommission ? fetch(`/api/commission-rates?actorId=${actor.id}`) : Promise.resolve(null),
    ]);
    const [priceData, linkData, customData, commissionData] = await Promise.all([
      priceRes.json(),
      linkRes.json(),
      customRes.json(),
      commissionRes ? commissionRes.json() : Promise.resolve({ rates: [] }),
    ]);
    const versions: PriceVersion[] = priceRes.ok ? priceData.priceVersions ?? [] : [];
    const custom: ActorCustomPlan[] = customRes.ok ? customData.customPlans ?? [] : [];
    const rates: CommissionRate[] = commissionRes?.ok ? commissionData.rates ?? [] : [];
    // Every setState call below happens after the awaits above, so this is
    // not a synchronous effect update — known limitation of the static
    // analysis behind react-hooks/set-state-in-effect (facebook/react#34905).
    setPriceVersions(versions);
    setLinks(linkRes.ok ? linkData.links ?? [] : []);
    setCustomPlans(custom);
    setPrices(Object.fromEntries(plans.map((plan) => {
      const current = versions.find((version) => version.plan_id === plan.id && version.effective_until === null);
      // `plans` here is always RECURRING (see loadDetail's caller/comment below), so standard_value is never null in practice — the `?? 0` is just to satisfy the wider Plan type.
      return [plan.id, String(current ? current.value : plan.standard_value ?? 0)];
    })));
    setInstallments(Object.fromEntries(plans.map((plan) => [plan.id, String(plan.annual_installment_limit ?? 6)])));
    setCustomEdits(Object.fromEntries(custom.map((item) => [item.id, { value: String(item.value), maxInstallments: String(item.max_installments ?? 6) }])));
    setCommissionRates(rates);
    const defaultRate = rates.find((rate) => rate.plan_id === null && rate.custom_plan_id === null);
    const edits: Record<string, string> = { default: defaultRate ? String(defaultRate.rate_percent) : "" };
    for (const plan of plans) {
      const specific = rates.find((rate) => rate.plan_id === plan.id);
      edits[`plan:${plan.id}`] = specific ? String(specific.rate_percent) : "";
    }
    for (const item of custom) {
      const specific = rates.find((rate) => rate.custom_plan_id === item.id);
      edits[`custom:${item.id}`] = specific ? String(specific.rate_percent) : "";
    }
    setCommissionEdits(edits);
  }

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes the freshly-defined loadDetail function identity; actor.id/plans already capture its reactive inputs.
  }, [actor.id, plans]);

  function priceFor(plan: Plan) {
    const raw = Number(prices[plan.id]);
    return Number.isFinite(raw) && raw > 0 ? raw : plan.standard_value ?? 0;
  }

  function installmentsFor(plan: Plan) {
    return clampInstallments(installments[plan.id], plan.annual_installment_limit ?? 6);
  }

  const candidates: LinkCandidate[] = [
    ...plans.map((plan): LinkCandidate => ({
      key: `plan:${plan.id}`,
      planId: plan.id,
      customPlanId: null,
      name: plan.name,
      // `plans` here is always pre-filtered to kind === "RECURRING" by the
      // caller (app/page.tsx) — Implantação/Consultoria (billing "ONE_TIME")
      // never reach this per-actor pricing/link table.
      billingPeriod: plan.billing_period as BillingPeriod,
      value: priceFor(plan),
      maxInstallments: plan.billing_period === "ANNUAL" ? installmentsFor(plan) : null,
    })),
    ...customPlans.map((item): LinkCandidate => ({
      key: `custom:${item.id}`,
      planId: null,
      customPlanId: item.id,
      name: item.name,
      billingPeriod: item.billing_period,
      value: Number(customEdits[item.id]?.value ?? item.value) || item.value,
      maxInstallments: item.billing_period === "ANNUAL" ? clampInstallments(customEdits[item.id]?.maxInstallments, item.max_installments ?? 6) : null,
    })),
  ];

  const pendingCandidates = candidates.filter((candidate) => !links.some((link) => (
    link.status === "ACTIVE" && (candidate.planId ? link.plan_id === candidate.planId : link.custom_plan_id === candidate.customPlanId)
  )));
  const selectedCandidates = pendingCandidates.filter((candidate) => !deselectedKeys.has(candidate.key));
  const allSelected = pendingCandidates.length > 0 && selectedCandidates.length === pendingCandidates.length;

  function toggleAll() {
    setDeselectedKeys(allSelected ? new Set(pendingCandidates.map((candidate) => candidate.key)) : new Set());
  }

  function toggleCandidate(key: string, checked: boolean) {
    setDeselectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function savePrices() {
    setSavingPrices(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const results = await Promise.all([
        ...plans.map(async (plan) => {
          const value = Number(prices[plan.id]);
          const limit = plan.billing_period === "ANNUAL" ? clampInstallments(installments[plan.id], plan.annual_installment_limit ?? 6) : null;
          const requests: Promise<Response>[] = [];
          if (Number.isFinite(value) && value > 0) {
            requests.push(fetch("/api/price-versions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ actorId: actor.id, planId: plan.id, value, effectiveFrom: today, changeReason: "Atualização manual via painel" }),
            }));
          }
          if (limit !== null && limit !== (plan.annual_installment_limit ?? 6)) {
            requests.push(fetch("/api/plans", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: plan.id, annualInstallmentLimit: limit }) }));
          }
          const responses = await Promise.all(requests);
          return responses.every((response) => response.ok);
        }),
        ...customPlans.map(async (item) => {
          const edit = customEdits[item.id];
          if (!edit) return true;
          const value = Number(edit.value);
          const limit = item.billing_period === "ANNUAL" ? clampInstallments(edit.maxInstallments, item.max_installments ?? 6) : null;
          const body: Record<string, unknown> = { id: item.id };
          if (Number.isFinite(value) && value > 0 && value !== item.value) body.value = value;
          if (limit !== null && limit !== (item.max_installments ?? 6)) body.maxInstallments = limit;
          if (Object.keys(body).length === 1) return true;
          const response = await fetch("/api/actor-custom-plans", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          return response.ok;
        }),
      ]);
      if (results.some((ok) => !ok)) { toast.error("Algumas alterações não foram salvas."); return; }
      toast.success("Tabela de preços atualizada.");
      await loadDetail();
    } finally {
      setSavingPrices(false);
    }
  }

  async function saveCommissionRates() {
    setSavingCommission(true);
    try {
      const entries: Array<{ key: string; planId: string | null; customPlanId: string | null }> = [
        { key: "default", planId: null, customPlanId: null },
        ...plans.map((plan) => ({ key: `plan:${plan.id}`, planId: plan.id, customPlanId: null })),
        ...customPlans.map((item) => ({ key: `custom:${item.id}`, planId: null, customPlanId: item.id })),
      ];
      const results = await Promise.all(entries.map(async ({ key, planId, customPlanId }) => {
        const raw = commissionEdits[key] ?? "";
        const existing = commissionRates.find((rate) => (planId ? rate.plan_id === planId : customPlanId ? rate.custom_plan_id === customPlanId : rate.plan_id === null && rate.custom_plan_id === null));
        if (raw.trim() === "") {
          if (!existing) return true;
          const response = await fetch(`/api/commission-rates?id=${existing.id}`, { method: "DELETE" });
          return response.ok;
        }
        const ratePercent = Number(raw);
        if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) return false;
        if (existing && existing.rate_percent === ratePercent) return true;
        const response = await fetch("/api/commission-rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actorId: actor.id, planId, customPlanId, ratePercent }),
        });
        return response.ok;
      }));
      if (results.some((ok) => !ok)) { toast.error("Algumas taxas de comissão não foram salvas."); return; }
      toast.success("Taxas de comissão atualizadas.");
      await loadDetail();
    } finally {
      setSavingCommission(false);
    }
  }

  async function addCustomPlan() {
    const name = customName.trim();
    const value = Number(customValue);
    if (!name || !Number.isFinite(value) || value <= 0) { toast.error("Informe nome e valor válidos."); return; }
    setCreatingCustomPlan(true);
    try {
      const response = await fetch("/api/actor-custom-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: actor.id, name, billingPeriod: customBillingPeriod, value, maxInstallments: clampInstallments(customInstallments) }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível criar o plano."); return; }
      toast.success("Plano personalizado adicionado.");
      setCustomName(""); setCustomValue(""); setCustomBillingPeriod("MONTHLY"); setCustomInstallments("6"); setCustomDialog(false);
      await loadDetail();
    } finally {
      setCreatingCustomPlan(false);
    }
  }

  async function removeCustomPlan(id: string) {
    const response = await fetch(`/api/actor-custom-plans?id=${id}`, { method: "DELETE" });
    if (!response.ok) { toast.error("Não foi possível remover o plano."); return; }
    toast.success("Plano personalizado removido.");
    await loadDetail();
  }

  async function generateSelectedLinks() {
    if (selectedCandidates.length === 0) return;
    setCreatingLinks(true);
    setLinkStatus("");
    try {
      let successCount = 0;
      const failureReasons: string[] = [];
      for (const candidate of selectedCandidates) {
        const response = await fetch("/api/asaas/payment-links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partnerId: actor.id,
            partnerName: actor.name,
            planId: candidate.planId,
            customPlanId: candidate.customPlanId,
            planName: candidate.name,
            billingPeriod: candidate.billingPeriod,
            priceVersion: "V1",
            value: candidate.value,
            maxInstallments: candidate.maxInstallments,
          }),
        });
        if (response.ok) { successCount += 1; continue; }
        const data = await response.json().catch(() => ({}));
        const reason = data.error ?? "não foi possível gerar o link.";
        failureReasons.push(`${candidate.name}: ${reason}`);
        toast.error(`${candidate.name} (${candidate.billingPeriod === "ANNUAL" ? "Anual" : "Mensal"}): ${reason}`);
      }
      if (successCount > 0) {
        toast.success(successCount === selectedCandidates.length ? `${successCount} link(s) gerado(s) no Asaas.` : `${successCount} de ${selectedCandidates.length} link(s) gerado(s).`);
        setDeselectedKeys(new Set());
        await loadDetail();
        onChanged();
      } else {
        setLinkStatus(failureReasons.length > 0 ? failureReasons.join(" | ") : "Não foi possível gerar os links selecionados.");
      }
    } finally {
      setCreatingLinks(false);
    }
  }

  function copyLink(url: string | null) {
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado.");
  }

  async function syncPayments() {
    setSyncingPayments(true);
    try {
      const response = await fetch("/api/asaas/sync-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorId: actor.id }) });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Não foi possível sincronizar."); return; }
      toast.success(`${data.payments} pagamento(s) sincronizado(s) do Asaas.`);
      await loadDetail();
      onChanged();
    } finally {
      setSyncingPayments(false);
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-[#3b82f6]">{actorCategoryLabel(actor)} selecionado</p><h2 className="mt-2 text-lg font-semibold">{actor.name}</h2><p className="text-sm text-slate-500">Tabela própria e links Asaas</p></div>
        <Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>
      </div>
      <Tabs defaultValue="data" className="mt-5">
        <TabsList className={`grid w-full ${canEarnCommission ? "grid-cols-5" : "grid-cols-4"}`}>
          <TabsTrigger value="data">Dados</TabsTrigger>
          <TabsTrigger value="prices">Preços</TabsTrigger>
          <TabsTrigger value="links">Links</TabsTrigger>
          {canEarnCommission && <TabsTrigger value="commission">Comissão</TabsTrigger>}
          <TabsTrigger value="performance">Resultado</TabsTrigger>
        </TabsList>
        <TabsContent value="data" className="mt-4 space-y-4">
          {connectRoles.includes(actor.role as typeof connectRoles[number]) && (
            <div className="space-y-2 rounded-xl border border-[#3b82f6]/30 bg-[#eef4fd] p-3">
              <div className="flex items-center justify-between gap-2">
                <div><p className="text-sm font-medium">Categoria no Connect</p><p className="text-xs text-slate-500">Reclassifique entre Parceiro, Embaixador e Institucional a qualquer momento. Não altera taxas de repasse já configuradas por plano — a taxa padrão da categoria pode ser restaurada na aba Comissão.</p></div>
                <Select value={profileRole} onValueChange={(value) => setProfileRole(value as CommercialActor["role"])}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {connectRoles.map((role) => <SelectItem key={role} value={role}>{roleLabels[role]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {profileRole !== actor.role && <p className="text-xs font-medium text-amber-600">Categoria será alterada para {roleLabels[profileRole]} ao salvar.</p>}
            </div>
          )}
          {profileRole === "PARTNER" && (
            <div className="space-y-2 rounded-xl border border-[#3b82f6]/30 bg-[#eef4fd] p-3">
              <div className="flex items-center justify-between gap-2">
                <div><p className="text-sm font-medium">Tier do parceiro</p><p className="text-xs text-slate-500">Plus dá 15% de repasse em vez de 10% — critério sugerido: {CONNECT_PLUS_ELIGIBILITY_CLIENTS}+ planos vendidos e ativos. Promoção é manual.</p></div>
                <Select value={profileTier} onValueChange={(value) => setProfileTier(value as "STANDARD" | "PLUS")}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STANDARD">Parceiro</SelectItem>
                    <SelectItem value="PLUS">Parceiro Plus</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {metrics.clients >= CONNECT_PLUS_ELIGIBILITY_CLIENTS && profileTier === "STANDARD" && (
                <p className="text-xs font-medium text-[#3a5d9d]">Elegível para Plus: {metrics.clients} clientes ativos.</p>
              )}
            </div>
          )}
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Dados pessoais</p>
            <div className="grid grid-cols-2 gap-3">
              <Input value={profileEmail} onChange={(event) => setProfileEmail(event.target.value)} placeholder="E-mail" type="email" />
              <Input value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} placeholder="Telefone" />
            </div>
            <Input value={profileDocument} onChange={(event) => setProfileDocument(event.target.value)} placeholder="CPF ou CNPJ" />
            <Input value={profileNotes} onChange={(event) => setProfileNotes(event.target.value)} placeholder="Observações" />
          </div>
          <div className="space-y-3 border-t border-dashed border-slate-200 pt-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Redes sociais</p>
            <div className="grid grid-cols-2 gap-3">
              <Input value={profileInstagram} onChange={(event) => setProfileInstagram(event.target.value)} placeholder="Instagram" />
              <Input value={profileLinkedin} onChange={(event) => setProfileLinkedin(event.target.value)} placeholder="LinkedIn" />
              <Input value={profileYoutube} onChange={(event) => setProfileYoutube(event.target.value)} placeholder="YouTube" />
              <Input value={profileTiktok} onChange={(event) => setProfileTiktok(event.target.value)} placeholder="TikTok" />
              <Input value={profileTwitterX} onChange={(event) => setProfileTwitterX(event.target.value)} placeholder="X / Twitter" />
              <Input value={profileWebsite} onChange={(event) => setProfileWebsite(event.target.value)} placeholder="Site / blog" />
            </div>
          </div>
          <div className="space-y-3 border-t border-dashed border-slate-200 pt-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Dados bancários — para o repasse</p>
            <Input value={profilePixKey} onChange={(event) => setProfilePixKey(event.target.value)} placeholder="Chave Pix" />
            <div className="grid grid-cols-2 gap-3">
              <Input value={profileBankName} onChange={(event) => setProfileBankName(event.target.value)} placeholder="Banco" />
              <Select value={profileBankAccountType} onValueChange={(value) => setProfileBankAccountType(value as "CORRENTE" | "POUPANCA" | "NONE")}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Tipo de conta" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Tipo de conta</SelectItem>
                  <SelectItem value="CORRENTE">Conta corrente</SelectItem>
                  <SelectItem value="POUPANCA">Conta poupança</SelectItem>
                </SelectContent>
              </Select>
              <Input value={profileBankAgency} onChange={(event) => setProfileBankAgency(event.target.value)} placeholder="Agência" />
              <Input value={profileBankAccount} onChange={(event) => setProfileBankAccount(event.target.value)} placeholder="Conta" />
            </div>
            <Input value={profileBankNotes} onChange={(event) => setProfileBankNotes(event.target.value)} placeholder="Outras informações bancárias (ex.: titular da conta)" />
          </div>
          <div className="flex justify-end pt-1">
            <Button disabled={savingProfile} onClick={saveProfile} variant="outline">{savingProfile ? "Salvando…" : "Salvar dados"}</Button>
          </div>
        </TabsContent>
        <TabsContent value="prices" className="mt-4 space-y-3">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div><p className="text-sm font-medium">{plan.name}</p><p className="text-xs text-slate-500">{plan.billing_period === "ANNUAL" ? "Anual · contrato de 12 meses" : "Mensal"}</p></div>
                <Badge variant="outline">Tabela: {money.format(plan.standard_value ?? 0)}</Badge>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-slate-500">R$</span>
                <Input type="number" step="0.01" value={prices[plan.id] ?? ""} onChange={(event) => setPrices((current) => ({ ...current, [plan.id]: event.target.value }))} />
                {plan.billing_period === "ANNUAL" && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="whitespace-nowrap text-xs text-slate-500">até</span>
                    <Input type="number" min={MIN_INSTALLMENTS} max={MAX_INSTALLMENTS} className="w-16 px-2 text-center" value={installments[plan.id] ?? "6"} onChange={(event) => setInstallments((current) => ({ ...current, [plan.id]: event.target.value }))} />
                    <span className="whitespace-nowrap text-xs text-slate-500">x</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          <div className="space-y-2 border-t border-dashed border-slate-200 pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Planos personalizados</p>
              <Dialog open={customDialog} onOpenChange={setCustomDialog}>
                <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="size-3.5" />Adicionar plano</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Adicionar plano personalizado</DialogTitle><DialogDescription>Vale só para {actor.name} — não entra no catálogo padrão.</DialogDescription></DialogHeader>
                  <div className="space-y-3">
                    <Input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Nome do plano" />
                    <Select value={customBillingPeriod} onValueChange={(value) => setCustomBillingPeriod(value as BillingPeriod)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="MONTHLY">Mensal</SelectItem><SelectItem value="ANNUAL">Anual</SelectItem></SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">R$</span>
                      <Input type="number" step="0.01" value={customValue} onChange={(event) => setCustomValue(event.target.value)} placeholder="Valor" />
                    </div>
                    {customBillingPeriod === "ANNUAL" && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500">Parcelamento até</span>
                        <Input type="number" min={MIN_INSTALLMENTS} max={MAX_INSTALLMENTS} className="w-16 px-2 text-center" value={customInstallments} onChange={(event) => setCustomInstallments(event.target.value)} />
                        <span className="text-xs text-slate-500">x</span>
                      </div>
                    )}
                  </div>
                  <DialogFooter><Button disabled={creatingCustomPlan} onClick={addCustomPlan}>{creatingCustomPlan ? "Adicionando…" : "Adicionar plano"}</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {customPlans.length === 0 && <p className="text-sm text-slate-500">Nenhum plano personalizado para {actor.name}.</p>}
            {customPlans.map((item) => (
              <div key={item.id} className="rounded-xl border border-dashed border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-slate-500">{item.billing_period === "ANNUAL" ? "Anual · contrato de 12 meses" : "Mensal"}</p></div>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="border-[#3b82f6]/30 text-[#3b82f6]">Personalizado</Badge>
                    <Button variant="ghost" size="icon" onClick={() => removeCustomPlan(item.id)}><Trash2 className="size-4" /><span className="sr-only">Remover plano</span></Button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm text-slate-500">R$</span>
                  <Input type="number" step="0.01" value={customEdits[item.id]?.value ?? String(item.value)} onChange={(event) => setCustomEdits((current) => ({ ...current, [item.id]: { value: event.target.value, maxInstallments: current[item.id]?.maxInstallments ?? String(item.max_installments ?? 6) } }))} />
                  {item.billing_period === "ANNUAL" && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="whitespace-nowrap text-xs text-slate-500">até</span>
                      <Input type="number" min={MIN_INSTALLMENTS} max={MAX_INSTALLMENTS} className="w-16 px-2 text-center" value={customEdits[item.id]?.maxInstallments ?? String(item.max_installments ?? 6)} onChange={(event) => setCustomEdits((current) => ({ ...current, [item.id]: { value: current[item.id]?.value ?? String(item.value), maxInstallments: event.target.value } }))} />
                      <span className="whitespace-nowrap text-xs text-slate-500">x</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-slate-500">{priceVersions.find((version) => version.effective_until === null) ? `Vigente desde ${new Date(priceVersions.find((version) => version.effective_until === null)!.effective_from).toLocaleDateString("pt-BR")}` : "Usando tabela padrão dos planos"}</p>
            <Button disabled={savingPrices} onClick={savePrices} variant="outline">{savingPrices ? "Salvando…" : "Salvar alterações"}</Button>
          </div>
        </TabsContent>
        <TabsContent value="links" className="mt-4 space-y-4">
          {links.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Links gerados</p>
                <Button variant="ghost" size="sm" disabled={syncingPayments} onClick={syncPayments} className="h-7 gap-1.5 text-xs text-[#3b82f6]">
                  <RefreshCw className={`size-3.5 ${syncingPayments ? "animate-spin" : ""}`} />{syncingPayments ? "Sincronizando…" : "Sincronizar pagamentos"}
                </Button>
              </div>
              {links.map((link) => (
                <div key={link.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <div>
                    <p className="text-sm font-medium">{link.display_name}</p>
                    <p className="text-xs text-slate-500">{link.billing_period === "ANNUAL" ? "Anual" : "Mensal"} · {money.format(link.value)}{link.billing_period === "ANNUAL" && link.max_installments ? ` · até ${link.max_installments}x` : ""}</p>
                    <p className="mt-1 text-xs font-medium text-[#3b82f6]">
                      {link.active_subscribers ?? 0} assinatura(s) ativa(s) · {money.format(link.total_received ?? 0)} recebido(s)
                    </p>
                  </div>
                  <Button onClick={() => copyLink(link.url)} variant="ghost" size="icon"><Copy className="size-4" /></Button>
                </div>
              ))}
            </div>
          )}

          {pendingCandidates.length > 0 ? (
            <div className="space-y-3 rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  Selecionar todos os planos
                </label>
                <span className="text-xs text-slate-500">{selectedCandidates.length} de {pendingCandidates.length} selecionado(s)</span>
              </div>
              <div className="space-y-2">
                {pendingCandidates.map((candidate) => (
                  <label key={candidate.key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-2.5 hover:bg-slate-50">
                    <span className="flex items-center gap-2.5">
                      <Checkbox checked={!deselectedKeys.has(candidate.key)} onCheckedChange={(checked) => toggleCandidate(candidate.key, checked === true)} />
                      <span>
                        <p className="text-sm font-medium">{candidate.name}{candidate.customPlanId && <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-[#3b82f6]">personalizado</span>}</p>
                        <p className="text-xs text-slate-500">{candidate.billingPeriod === "ANNUAL" ? `Anual · até ${candidate.maxInstallments}x` : "Mensal"}</p>
                      </span>
                    </span>
                    <span className="text-sm font-medium">{money.format(candidate.value)}</span>
                  </label>
                ))}
              </div>
              {linkStatus && <p role="alert" className="text-sm text-red-600">{linkStatus}</p>}
              <Button className="w-full bg-[#3a5d9d] text-white hover:bg-[#2c4a80]" disabled={creatingLinks || selectedCandidates.length === 0} onClick={generateSelectedLinks}>
                <Link2 className="size-4" />{creatingLinks ? "Gerando…" : `Gerar ${selectedCandidates.length || ""} link${selectedCandidates.length === 1 ? "" : "s"} no Asaas`}
              </Button>
            </div>
          ) : links.length > 0 ? (
            <p className="text-sm text-slate-500">Todos os planos já têm link gerado.</p>
          ) : (
            <p className="text-sm text-slate-500">Nenhum plano disponível para gerar link.</p>
          )}
        </TabsContent>
        {canEarnCommission && (
          <TabsContent value="commission" className="mt-4 space-y-3">
            <p className="text-xs text-slate-500">Taxa de repasse sobre o MRR do plano. Anual: distribuída pelos 12 meses do ciclo enquanto a assinatura estiver ativa (não importa se foi pago em 1x, 8x ou 12x). Mensal: só no mês do pagamento. Deixe um plano em branco para usar a taxa padrão.</p>
            <div className="rounded-xl border border-[#3b82f6]/30 bg-[#eef4fd] p-3">
              <div className="flex items-center justify-between gap-2">
                <div><p className="text-sm font-medium">Taxa padrão</p><p className="text-xs text-slate-500">Usada quando o plano vendido não tem taxa específica</p></div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" step="0.1" min={0} max={100} className="w-20 text-right" placeholder="0" value={commissionEdits.default ?? ""} onChange={(event) => setCommissionEdits((current) => ({ ...current, default: event.target.value }))} />
                  <span className="text-sm text-slate-500">%</span>
                </div>
              </div>
              {connectDefaultRatePercent(actor.role, actor.tier) !== null && (
                <Button variant="link" size="sm" className="h-auto px-0 text-xs text-[#3a5d9d]" onClick={applyDefaultCommissionRate}>
                  Usar taxa padrão da categoria ({connectDefaultRatePercent(actor.role, actor.tier)}%)
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Taxa por plano (opcional)</p>
              {candidates.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2.5">
                  <div><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-slate-500">{item.billingPeriod === "ANNUAL" ? "Anual" : "Mensal"} · {money.format(item.value)}</p></div>
                  <div className="flex items-center gap-1.5">
                    <Input type="number" step="0.1" min={0} max={100} className="w-20 text-right" placeholder="padrão" value={commissionEdits[item.key] ?? ""} onChange={(event) => setCommissionEdits((current) => ({ ...current, [item.key]: event.target.value }))} />
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                </div>
              ))}
              {candidates.length === 0 && <p className="text-sm text-slate-500">Nenhum plano cadastrado ainda.</p>}
            </div>
            <div className="flex justify-end pt-1">
              <Button disabled={savingCommission} onClick={saveCommissionRates} variant="outline">{savingCommission ? "Salvando…" : "Salvar taxas de comissão"}</Button>
            </div>
          </TabsContent>
        )}
        <TabsContent value="performance" className="mt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Clientes</p><p className="mt-1 text-xl font-semibold">{metrics.clients}</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">MRR</p><p className="mt-1 text-xl font-semibold">{money.format(metrics.mrr)}</p></div>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
