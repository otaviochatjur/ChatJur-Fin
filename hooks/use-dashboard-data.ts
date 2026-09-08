"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActorMetrics, AuditEvent, CommercialActor, ConnectLead, Customer, ImplementationPayment, Payment, PaymentLink, Plan, Subscription } from "@/lib/metrics";

import type { CustomerActivity } from "@/lib/customer-activity";

type Totals = { activeLinks: number; mrr: number; clients: number; realizedThisMonth: number; realizedTotal: number; implementationThisMonth: number; implementationTotal: number };

export function useDashboardData() {
  const [events, setEvents] = useState<CustomerActivity[]>([]);
  const [actors, setActors] = useState<CommercialActor[]>([]);
  const [metrics, setMetrics] = useState<Record<string, ActorMetrics>>({});
  const [totals, setTotals] = useState<Totals>({ activeLinks: 0, mrr: 0, clients: 0, realizedThisMonth: 0, realizedTotal: 0, implementationThisMonth: 0, implementationTotal: 0 });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [implementationPayments, setImplementationPayments] = useState<ImplementationPayment[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [connectLeads, setConnectLeads] = useState<ConnectLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadConnectLeads = useCallback(async () => {
    const response = await fetch('/api/connect-leads', { signal: AbortSignal.timeout(20000), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Falha ao atualizar candidaturas.');
    setConnectLeads(data.leads ?? []);
  }, []);
  const reload = useCallback(async () => {
    // No setState before this first await: keeps this effect-safe per
    // react-hooks/set-state-in-effect (loading/error updates only happen
    // in the async continuation below, never synchronously on call).
    try {
      const [summaryRes, plansRes, customersRes, subscriptionsRes, paymentsRes, implementationPaymentsRes, auditRes, linksRes, leadsRes, eventsRes] = await Promise.all([
        fetch("/api/dashboard-summary", { signal: AbortSignal.timeout(20000) }),
        fetch("/api/plans", { signal: AbortSignal.timeout(20000) }),
        fetch("/api/customers", { signal: AbortSignal.timeout(20000) }),
        fetch("/api/subscriptions", { signal: AbortSignal.timeout(20000) }),
        fetch("/api/payments", { signal: AbortSignal.timeout(20000) }),
        fetch("/api/implementation-payments", { signal: AbortSignal.timeout(20000) }),
        fetch("/api/audit-events?limit=15", { signal: AbortSignal.timeout(20000) }),
        fetch("/api/asaas/payment-links", { signal: AbortSignal.timeout(20000) }),
        fetch("/api/connect-leads", { signal: AbortSignal.timeout(20000) }),
        fetch("/api/customer-activities", { signal: AbortSignal.timeout(20000) }),
      ]);
      const [summary, plansData, customersData, subscriptionsData, paymentsData, implementationPaymentsData, auditData, linksData, leadsData, eventsData] = await Promise.all([
        summaryRes.json(), plansRes.json(), customersRes.json(), subscriptionsRes.json(), paymentsRes.json(), implementationPaymentsRes.json(), auditRes.json(), linksRes.json(), leadsRes.json(), eventsRes.json(),
      ]);
      if (!summaryRes.ok) throw new Error(summary.error ?? "Não foi possível carregar os cadastros.");
      for (const [response, data] of [[customersRes, customersData], [subscriptionsRes, subscriptionsData], [paymentsRes, paymentsData], [eventsRes, eventsData]] as const) {
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar as métricas de clientes.");
      }
      setEvents(eventsData.events ?? []);
      setActors(summary.actors ?? []);
      setMetrics(summary.metrics ?? {});
      setTotals(summary.totals ?? { activeLinks: 0, mrr: 0, clients: 0, realizedThisMonth: 0, realizedTotal: 0, implementationThisMonth: 0, implementationTotal: 0 });
      setPlans(plansRes.ok ? plansData.plans ?? [] : []);
      setCustomers(customersRes.ok ? customersData.customers ?? [] : []);
      setSubscriptions(subscriptionsRes.ok ? subscriptionsData.subscriptions ?? [] : []);
      setPayments(paymentsRes.ok ? paymentsData.payments ?? [] : []);
      setImplementationPayments(implementationPaymentsRes.ok ? implementationPaymentsData.payments ?? [] : []);
      setAuditEvents(auditRes.ok ? auditData.events ?? [] : []);
      setLinks(linksRes.ok ? linksData.links ?? [] : []);
      setConnectLeads(leadsRes.ok ? leadsData.leads ?? [] : []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error && caught.name === "TimeoutError" ? "A consulta demorou mais que o esperado. Tente novamente." : caught instanceof Error ? caught.message : "Erro ao carregar dados do Supabase.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload only calls setState after its internal awaits resolve (facebook/react#34905).
    reload();
  }, [reload]);

  return { events, actors, metrics, totals, plans, customers, subscriptions, payments, implementationPayments, auditEvents, links, connectLeads, loading, error, reload, reloadConnectLeads };
}
