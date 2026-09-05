"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActorMetrics, AuditEvent, CommercialActor, ConnectLead, Customer, Payment, PaymentLink, Plan, Subscription } from "@/lib/metrics";

import type { CustomerActivity } from "@/lib/customer-activity";

type Totals = { activeLinks: number; mrr: number; clients: number; realizedThisMonth: number; realizedTotal: number };

export function useDashboardData() {
  const [events, setEvents] = useState<CustomerActivity[]>([]);
  const [actors, setActors] = useState<CommercialActor[]>([]);
  const [metrics, setMetrics] = useState<Record<string, ActorMetrics>>({});
  const [totals, setTotals] = useState<Totals>({ activeLinks: 0, mrr: 0, clients: 0, realizedThisMonth: 0, realizedTotal: 0 });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [connectLeads, setConnectLeads] = useState<ConnectLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // No setState before this first await: keeps this effect-safe per
    // react-hooks/set-state-in-effect (loading/error updates only happen
    // in the async continuation below, never synchronously on call).
    try {
      const [summaryRes, plansRes, customersRes, subscriptionsRes, paymentsRes, auditRes, linksRes, leadsRes, eventsRes] = await Promise.all([
        fetch("/api/dashboard-summary"),
        fetch("/api/plans"),
        fetch("/api/customers"),
        fetch("/api/subscriptions"),
        fetch("/api/payments"),
        fetch("/api/audit-events?limit=15"),
        fetch("/api/asaas/payment-links"),
        fetch("/api/connect-leads"),
        fetch("/api/customer-activities"),
      ]);
      const [summary, plansData, customersData, subscriptionsData, paymentsData, auditData, linksData, leadsData, eventsData] = await Promise.all([
        summaryRes.json(), plansRes.json(), customersRes.json(), subscriptionsRes.json(), paymentsRes.json(), auditRes.json(), linksRes.json(), leadsRes.json(), eventsRes.json(),
      ]);
      if (!summaryRes.ok) throw new Error(summary.error ?? "Não foi possível carregar os cadastros.");
      for (const [response, data] of [[customersRes, customersData], [subscriptionsRes, subscriptionsData], [paymentsRes, paymentsData], [eventsRes, eventsData]] as const) {
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar as métricas de clientes.");
      }
      setEvents(eventsData.events ?? []);
      setActors(summary.actors ?? []);
      setMetrics(summary.metrics ?? {});
      setTotals(summary.totals ?? { activeLinks: 0, mrr: 0, clients: 0, realizedThisMonth: 0, realizedTotal: 0 });
      setPlans(plansRes.ok ? plansData.plans ?? [] : []);
      setCustomers(customersRes.ok ? customersData.customers ?? [] : []);
      setSubscriptions(subscriptionsRes.ok ? subscriptionsData.subscriptions ?? [] : []);
      setPayments(paymentsRes.ok ? paymentsData.payments ?? [] : []);
      setAuditEvents(auditRes.ok ? auditData.events ?? [] : []);
      setLinks(linksRes.ok ? linksData.links ?? [] : []);
      setConnectLeads(leadsRes.ok ? leadsData.leads ?? [] : []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Erro ao carregar dados do Supabase.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload only calls setState after its internal awaits resolve (facebook/react#34905).
    reload();
  }, [reload]);

  return { events, actors, metrics, totals, plans, customers, subscriptions, payments, auditEvents, links, connectLeads, loading, error, reload };
}
