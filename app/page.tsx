"use client";

import { BackgroundUpdates } from "@/components/dashboard/background-updates";
import Image from "next/image";
import { AsaasBaseSync } from "@/components/dashboard/asaas-base-sync";
import { SectionBoundary, SectionLoading } from "@/components/dashboard/section-boundary";
import { AuthGate } from "@/components/auth-gate";
import { lazy, Suspense, useState } from "react";
import { Activity, Banknote, Building2, CalendarClock, Handshake, LayoutDashboard, TriangleAlert, Users, Plug, Send } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

import { OverviewSection } from "@/components/dashboard/overview-section";
import { useDashboardData } from "@/hooks/use-dashboard-data";

const loadClientsSection = () => import("@/components/dashboard/clients-section").then(module => ({ default: module.ClientsSection }));
const ClientsSection = lazy(loadClientsSection);
const loadConnectSection = () => import("@/components/dashboard/connect-section").then(module => ({ default: module.ConnectSection }));
const ConnectSection = lazy(loadConnectSection);
const loadCommercialSection = () => import("@/components/dashboard/commercial-section").then(module => ({ default: module.CommercialSection }));
const CommercialSection = lazy(loadCommercialSection);
const loadPayoutsSection = () => import("@/components/dashboard/payouts-section").then(module => ({ default: module.PayoutsSection }));
const PayoutsSection = lazy(loadPayoutsSection);
const loadRenewalsSection = () => import("@/components/dashboard/renewals-section").then(module => ({ default: module.RenewalsSection }));
const RenewalsSection = lazy(loadRenewalsSection);
const loadPlansUsageSection = () => import("@/components/dashboard/plans-usage-section").then(module => ({ default: module.PlansUsageSection }));
const PlansUsageSection = lazy(loadPlansUsageSection);

const loadIntegrationsSection = () => import("@/components/dashboard/integrations-section").then(module => ({ default: module.IntegrationsSection }));
const IntegrationsSection = lazy(loadIntegrationsSection);
const loadCollectionsSection = () => import("@/components/dashboard/collections-section").then(module => ({ default: module.CollectionsSection }));
const CollectionsSection = lazy(loadCollectionsSection);

const sectionLoaders: Record<string, () => Promise<unknown>> = {
  clients: loadClientsSection, connect: loadConnectSection, commercial: loadCommercialSection,
  payouts: loadPayoutsSection, renewals: loadRenewalsSection,
  usage: loadPlansUsageSection, integrations: loadIntegrationsSection, collections: loadCollectionsSection,
};
function warmSection(id: string) { void sectionLoaders[id]?.().catch(() => undefined); }

const sections = [
  { id: "dashboard", label: "Visão geral", Icon: LayoutDashboard, title: "Visão geral", subtitle: "Acompanhe os resultados e a evolução da carteira" },
  { id: "clients", label: "Clientes", Icon: Building2, title: "Clientes", subtitle: "Histórico, evolução comercial e acompanhamento de cada cliente" },
  { id: "connect", label: "Chat Jurídico Connect", Icon: Handshake, title: "Chat Jurídico Connect", subtitle: "Parceiros, Embaixadores, Institucional e candidaturas do programa" },
  { id: "commercial", label: "Comercial", Icon: Users, title: "Comercial", subtitle: "Equipe de vendas interna e externa" },
  { id: "payouts", label: "Repasses", Icon: Banknote, title: "Repasses", subtitle: "Comissões sobre os pagamentos recebidos" },
  { id: "renewals", label: "Renovações", Icon: CalendarClock, title: "Renovações", subtitle: "Contratos anuais próximos do vencimento" },
  { id: "usage", label: "Planos e Links", Icon: Activity, title: "Planos e Links", subtitle: "Catálogo de planos e vinculação dos links de pagamento" },
  { id: "collections", label: "Cobranças", Icon: Send, title: "Cobranças", subtitle: "Acompanhe os pagamentos em atraso" },
  { id: "integrations", label: "Integrações", Icon: Plug, title: "Integrações", subtitle: "Gerencie as conexões da sua conta" },
  { id: "form", label: "Formulário público", Icon: Handshake, title: "Formulário público", subtitle: "Inscrições no Chat Jurídico Connect" },
] as const;

export default function Home() { return <AuthGate><Dashboard /></AuthGate>; }

function Dashboard() {
  const [sectionId, setSectionId] = useState<(typeof sections)[number]["id"]>("dashboard");
  const { actors, metrics, plans, customers, subscriptions, payments, implementationPayments, events, links, connectLeads, error, reload, reloadConnectLeads } = useDashboardData();
  const pendingLeads = connectLeads.filter(lead => lead.status === "PENDING").length;
  const pendingBadge = <span aria-label={`${pendingLeads} candidaturas pendentes`} className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-blue-500/20 px-1.5 text-xs font-semibold text-blue-300">{pendingLeads}</span>;
  const active = sections.find((item) => item.id === sectionId) ?? sections[0];
  // Implantação (taxa única) não entra na tabela de preços por ator nem na
  // geração de links de assinatura — só o catálogo "Planos e Links" precisa
  // ver esse tipo de produto.
  const recurringPlans = plans.filter((plan) => plan.kind === "RECURRING");

  return (
    <div className="dashboard-shell min-h-screen bg-background text-foreground">
      <a href="#main-content" className="skip-link">Pular para o conteúdo</a><aside className="app-sidebar fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-white/10 px-4 py-6 text-white lg:flex">
        <div className="flex items-center gap-3 px-2">
          <div className="grid size-10 place-items-center rounded-xl bg-white p-1.5">
            <Image src="/brand/chat-juridico-icon.svg" alt="Chat Jurídico" width={28} height={28} />
          </div>
          <div><p className="font-semibold">Chat Jurídico</p><p className="text-xs text-slate-400">Controle financeiro</p></div>
        </div>
        <nav aria-label="Navegação principal" className="mt-9 flex-1 space-y-1 overflow-y-auto">
          <p className="px-3 pb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-muted-foreground">Gestão</p>
          {sections.map(({ id, label, Icon }) => (
            <button key={id} aria-current={sectionId === id ? "page" : undefined} onPointerEnter={() => warmSection(id)} onFocus={() => warmSection(id)} onClick={() => setSectionId(id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${sectionId === id ? "bg-blue-500/20 text-white shadow-[inset_3px_0_0_#60a5fa]" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
              <Icon className="size-4 shrink-0" />{label}{id === "connect" && pendingBadge}
            </button>
          ))}
        </nav>
        <div className="mt-6 border-t border-white/10 px-3 pt-5"><p className="text-xs text-slate-400">Chat Jurídico · Financeiro</p></div>
      </aside>
      <main id="main-content" tabIndex={-1} className="min-w-0 lg:ml-64">
        <header className="border-b border-border bg-card px-5 py-5 md:px-8">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
            <div><h1 className="text-2xl font-semibold tracking-tight">{active.title}</h1><p className="mt-0.5 text-sm text-slate-500 dark:text-muted-foreground">{active.subtitle}</p></div>
            <ThemeToggle />
          </div>
        </header>
        <nav aria-label="Navegação" className="flex gap-2 overflow-x-auto border-b bg-white dark:bg-card p-3 lg:hidden">{sections.map(({ id, label }) => <button key={id} aria-current={sectionId === id ? "page" : undefined} onPointerEnter={() => warmSection(id)} onFocus={() => warmSection(id)} onClick={() => setSectionId(id)} className={`shrink-0 rounded-lg px-3 py-2 text-sm ${sectionId === id ? "bg-primary text-primary-foreground" : "text-slate-600 dark:text-muted-foreground"}`}>{label}{id === "connect" && pendingBadge}</button>)}</nav>
        <div className="dashboard-content mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6 md:p-8">
          {error && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 p-4 text-sm text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Não foi possível carregar os dados</p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-300">{error}</p><button className="mt-2 underline" onClick={() => void reload()}>Tentar novamente</button>
              </div>
            </div>
          )}
          <AsaasBaseSync onChanged={reload} />
          <BackgroundUpdates onLeadsChanged={reloadConnectLeads} />
          <SectionBoundary key={sectionId}><Suspense fallback={<SectionLoading />}>
          {sectionId === "form" && <section className="rounded-2xl border bg-white dark:bg-card p-6"><h2 className="text-lg font-semibold">Formulário de inscrição</h2><p className="mt-2 text-sm text-slate-500 dark:text-muted-foreground">Compartilhe o formulário com candidatos a parceiros, embaixadores e instituições.</p><div className="mt-4 flex flex-wrap gap-4"><a className="font-medium text-blue-700 dark:text-blue-300 underline" href="/connect/inscricao" target="_blank" rel="noopener noreferrer">Abrir página do formulário</a><a className="font-medium text-blue-700 dark:text-blue-300 underline" href="https://tally.so/r/2EWBOV" target="_blank" rel="noopener noreferrer">Link público para compartilhar</a></div></section>}
          {sectionId === "dashboard" && <OverviewSection actors={actors} customers={customers} subscriptions={subscriptions} payments={payments} implementationPayments={implementationPayments} events={events} />}
          {sectionId === "clients" && <ClientsSection customers={customers} subscriptions={subscriptions} payments={payments} implementationPayments={implementationPayments} plans={plans} actors={actors} links={links} events={events} onChanged={reload} />}
          {sectionId === "connect" && <ConnectSection actors={actors} metrics={metrics} plans={recurringPlans} leads={connectLeads} onChanged={reload} />}
          {sectionId === "commercial" && <CommercialSection actors={actors} metrics={metrics} plans={recurringPlans} onChanged={reload} />}
          {sectionId === "payouts" && <PayoutsSection actors={actors} subscriptions={subscriptions} payments={payments} customers={customers} />}
          {sectionId === "renewals" && <RenewalsSection />}
          {sectionId === "usage" && <PlansUsageSection links={links} actors={actors} onChanged={reload} />}
          {sectionId === "integrations" && <IntegrationsSection />}
          {sectionId === "collections" && <CollectionsSection payments={payments} customers={customers} subscriptions={subscriptions} implementationPayments={implementationPayments} plans={plans} actors={actors} links={links} events={events} onChanged={reload} />}
          </Suspense></SectionBoundary>
        </div>
      </main>
    </div>
  );
}
