"use client";

import Image from "next/image";
import { useState } from "react";
import { Activity, Banknote, Building2, CalendarClock, CircleDollarSign, Handshake, LayoutDashboard, Search, Settings, TriangleAlert, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OverviewSection } from "@/components/dashboard/overview-section";
import { ClientsSection } from "@/components/dashboard/clients-section";
import { ConnectSection } from "@/components/dashboard/connect-section";
import { CommercialSection } from "@/components/dashboard/commercial-section";
import { PayoutsSection } from "@/components/dashboard/payouts-section";
import { RevenueSection } from "@/components/dashboard/revenue-section";
import { RenewalsSection } from "@/components/dashboard/renewals-section";
import { PlansUsageSection } from "@/components/dashboard/plans-usage-section";
import { useDashboardData } from "@/hooks/use-dashboard-data";

const sections = [
  { id: "dashboard", label: "Visão geral", Icon: LayoutDashboard, title: "Visão geral", subtitle: "Panorama financeiro e comercial em tempo real" },
  { id: "clients", label: "Clientes", Icon: Building2, title: "Clientes", subtitle: "Histórico, evolução comercial e acompanhamento de cada cliente" },
  { id: "connect", label: "Chat Jurídico Connect", Icon: Handshake, title: "Chat Jurídico Connect", subtitle: "Parceiros, Embaixadores, Institucional e candidaturas do programa" },
  { id: "form", label: "Formulário público", Icon: Handshake, title: "Formulário público", subtitle: "Inscrições no Chat Jurídico Connect" },
  { id: "commercial", label: "Comercial", Icon: Users, title: "Comercial", subtitle: "Equipe de vendas interna e externa" },
  { id: "payouts", label: "Repasses", Icon: Banknote, title: "Repasses", subtitle: "Comissão mensal sobre pagamentos recebidos por parceiro, embaixador, institucional e comercial externo" },
  { id: "revenue", label: "Receita e MRR", Icon: CircleDollarSign, title: "Receita e MRR", subtitle: "Faturamento recorrente consolidado" },
  { id: "renewals", label: "Renovações", Icon: CalendarClock, title: "Renovações", subtitle: "Contratos anuais próximos do vencimento" },
  { id: "usage", label: "Planos e Links", Icon: Activity, title: "Planos e Links", subtitle: "Catálogo de planos e vinculação dos links de pagamento" },
] as const;

export default function Home() {
  const [sectionId, setSectionId] = useState<(typeof sections)[number]["id"]>("dashboard");
  const { actors, metrics, totals, plans, customers, subscriptions, payments, implementationPayments, events, links, connectLeads, error, reload } = useDashboardData();
  const active = sections.find((item) => item.id === sectionId) ?? sections[0];
  // Implantação (taxa única) não entra na tabela de preços por ator nem na
  // geração de links de assinatura — só o catálogo "Planos e Links" precisa
  // ver esse tipo de produto.
  const recurringPlans = plans.filter((plan) => plan.kind === "RECURRING");

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-950">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-white/10 bg-[#0f1f3d] px-4 py-5 text-white lg:block">
        <div className="flex items-center gap-3 px-2">
          <div className="grid size-10 place-items-center rounded-xl bg-white p-1.5">
            <Image src="/brand/chat-juridico-icon.svg" alt="Chat Jurídico" width={28} height={28} />
          </div>
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
        <nav aria-label="Navegação" className="flex gap-2 overflow-x-auto border-b bg-white p-3 lg:hidden">{sections.map(({ id, label }) => <button key={id} onClick={() => setSectionId(id)} className={`shrink-0 rounded-lg px-3 py-2 text-sm ${sectionId === id ? "bg-blue-100 text-blue-900" : "text-slate-600"}`}>{label}</button>)}</nav>
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
          {sectionId === "form" && <section className="rounded-2xl border bg-white p-6"><h2 className="text-lg font-semibold">Formulário de inscrição</h2><p className="mt-2 text-sm text-slate-500">Compartilhe o formulário com candidatos a parceiros, embaixadores e instituições.</p><div className="mt-4 flex flex-wrap gap-4"><a className="font-medium text-blue-700 underline" href="/connect/inscricao" target="_blank" rel="noopener noreferrer">Abrir página do formulário</a><a className="font-medium text-blue-700 underline" href="https://tally.so/r/2EWBOV" target="_blank" rel="noopener noreferrer">Link público para compartilhar</a></div></section>}
          {sectionId === "dashboard" && <OverviewSection actors={actors} customers={customers} subscriptions={subscriptions} payments={payments} implementationPayments={implementationPayments} events={events} />}
          {sectionId === "clients" && <ClientsSection customers={customers} subscriptions={subscriptions} payments={payments} implementationPayments={implementationPayments} plans={plans} actors={actors} links={links} events={events} onChanged={reload} />}
          {sectionId === "connect" && <ConnectSection actors={actors} metrics={metrics} plans={recurringPlans} leads={connectLeads} onChanged={reload} />}
          {sectionId === "commercial" && <CommercialSection actors={actors} metrics={metrics} plans={recurringPlans} onChanged={reload} />}
          {sectionId === "payouts" && <PayoutsSection actors={actors} subscriptions={subscriptions} payments={payments} customers={customers} />}
          {sectionId === "revenue" && <RevenueSection subscriptions={subscriptions} payments={payments} plans={plans} totals={totals} />}
          {sectionId === "renewals" && <RenewalsSection links={links} actors={actors} />}
          {sectionId === "usage" && <PlansUsageSection links={links} actors={actors} onChanged={reload} />}
        </div>
      </main>
    </div>
  );
}
