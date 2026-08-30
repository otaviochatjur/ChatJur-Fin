"use client";

import { useState } from "react";
import { Activity, BriefcaseBusiness, Building2, CalendarClock, CircleDollarSign, Handshake, LayoutDashboard, Search, Settings, ShieldCheck, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OverviewSection } from "@/components/dashboard/overview-section";
import { ClientsSection } from "@/components/dashboard/clients-section";
import { PartnersSection } from "@/components/dashboard/partners-section";
import { SellersSection } from "@/components/dashboard/sellers-section";
import { RevenueSection } from "@/components/dashboard/revenue-section";
import { RenewalsSection } from "@/components/dashboard/renewals-section";
import { PlansUsageSection } from "@/components/dashboard/plans-usage-section";
import { useDashboardData } from "@/hooks/use-dashboard-data";

const sections = [
  { id: "dashboard", label: "Visão geral", Icon: LayoutDashboard, title: "Visão geral", subtitle: "Panorama financeiro e comercial em tempo real" },
  { id: "clients", label: "Clientes", Icon: Building2, title: "Clientes", subtitle: "Origem comercial de cada cliente" },
  { id: "partners", label: "Parceiros", Icon: Handshake, title: "Parceiros e preços", subtitle: "Gestão comercial, atribuição e cobrança" },
  { id: "sellers", label: "Comerciais externos", Icon: BriefcaseBusiness, title: "Comerciais externos", subtitle: "Equipe de vendas sem vínculo de parceiro" },
  { id: "revenue", label: "Receita e MRR", Icon: CircleDollarSign, title: "Receita e MRR", subtitle: "Faturamento recorrente consolidado" },
  { id: "renewals", label: "Renovações", Icon: CalendarClock, title: "Renovações", subtitle: "Contratos anuais próximos do vencimento" },
  { id: "usage", label: "Uso e planos", Icon: Activity, title: "Uso e planos", subtitle: "Catálogo de planos e adoção por plano" },
] as const;

export default function Home() {
  const [sectionId, setSectionId] = useState<(typeof sections)[number]["id"]>("partners");
  const { actors, metrics, totals, plans, attributions, auditEvents, links, error, reload } = useDashboardData();
  const active = sections.find((item) => item.id === sectionId) ?? sections[0];

  return (
    <div className="min-h-screen bg-[#f4f7f6] text-slate-950">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-white/10 bg-[#0b1c27] px-4 py-5 text-white lg:block">
        <div className="flex items-center gap-3 px-2">
          <div className="grid size-10 place-items-center rounded-xl bg-[#93e3bd] text-[#0b1c27]"><ShieldCheck className="size-5" /></div>
          <div><p className="font-semibold">Chat Jurídico</p><p className="text-xs text-slate-400">Controle financeiro</p></div>
        </div>
        <nav className="mt-8 space-y-1">
          <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Gestão</p>
          {sections.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setSectionId(id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${sectionId === id ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>
              <Icon className="size-4" />{label}
            </button>
          ))}
        </nav>
        <div className="absolute bottom-5 left-4 right-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-2 text-xs text-slate-400"><span className={`size-2 rounded-full ${error ? "bg-amber-400" : "bg-emerald-400"}`} />{error ? "Supabase indisponível" : "Supabase conectado"}</div>
          <p className="mt-1 text-xs text-slate-300">{error ? "Verifique o .env" : "Integração ativa"}</p>
        </div>
      </aside>
      <main className="lg:ml-64">
        <header className="border-b border-slate-200/80 bg-white/80 px-5 py-4 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
            <div><h1 className="text-xl font-semibold tracking-tight">{active.title}</h1><p className="mt-0.5 text-sm text-slate-500">{active.subtitle}</p></div>
            <div className="flex items-center gap-2">
              <div className="relative hidden sm:block"><Search className="absolute left-3 top-2.5 size-4 text-slate-400" /><Input className="w-60 bg-white pl-9" placeholder="Buscar cliente ou parceiro" /></div>
              <Button variant="outline" size="icon"><Settings className="size-4" /><span className="sr-only">Configurações</span></Button>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-[1500px] space-y-5 p-5 md:p-8">
          {error && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Não foi possível carregar os dados do Supabase</p>
                <p className="mt-0.5 text-amber-700">{error} — confirme <code>SUPABASE_URL</code> e <code>SUPABASE_SERVICE_ROLE_KEY</code> no arquivo <code>.env</code>.</p>
              </div>
            </div>
          )}
          {sectionId === "dashboard" && <OverviewSection actors={actors} totals={totals} auditEvents={auditEvents} />}
          {sectionId === "clients" && <ClientsSection actors={actors} attributions={attributions} onCreated={reload} />}
          {sectionId === "partners" && <PartnersSection actors={actors} metrics={metrics} plans={plans} onChanged={reload} />}
          {sectionId === "sellers" && <SellersSection actors={actors} metrics={metrics} onChanged={reload} />}
          {sectionId === "revenue" && <RevenueSection links={links} plans={plans} totalMrr={totals.mrr} />}
          {sectionId === "renewals" && <RenewalsSection links={links} actors={actors} />}
          {sectionId === "usage" && <PlansUsageSection plans={plans} links={links} />}
        </div>
      </main>
    </div>
  );
}
