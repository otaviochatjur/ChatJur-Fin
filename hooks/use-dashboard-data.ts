"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActorMetrics, AuditEvent, CommercialActor, CustomerAttribution, PaymentLink, Plan } from "@/lib/metrics";

type Totals = { activeLinks: number; mrr: number; clients: number };

export function useDashboardData() {
  const [actors, setActors] = useState<CommercialActor[]>([]);
  const [metrics, setMetrics] = useState<Record<string, ActorMetrics>>({});
  const [totals, setTotals] = useState<Totals>({ activeLinks: 0, mrr: 0, clients: 0 });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [attributions, setAttributions] = useState<CustomerAttribution[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // No setState before this first await: keeps this effect-safe per
    // react-hooks/set-state-in-effect (loading/error updates only happen
    // in the async continuation below, never synchronously on call).
    try {
      const [summaryRes, plansRes, attributionsRes, auditRes, linksRes] = await Promise.all([
        fetch("/api/dashboard-summary"),
        fetch("/api/plans"),
        fetch("/api/customer-attributions"),
        fetch("/api/audit-events?limit=15"),
        fetch("/api/asaas/payment-links"),
      ]);
      const [summary, plansData, attributionsData, auditData, linksData] = await Promise.all([summaryRes.json(), plansRes.json(), attributionsRes.json(), auditRes.json(), linksRes.json()]);
      if (!summaryRes.ok) throw new Error(summary.error ?? "Não foi possível carregar os cadastros.");
      setActors(summary.actors ?? []);
      setMetrics(summary.metrics ?? {});
      setTotals(summary.totals ?? { activeLinks: 0, mrr: 0, clients: 0 });
      setPlans(plansRes.ok ? plansData.plans ?? [] : []);
      setAttributions(attributionsRes.ok ? attributionsData.attributions ?? [] : []);
      setAuditEvents(auditRes.ok ? auditData.events ?? [] : []);
      setLinks(linksRes.ok ? linksData.links ?? [] : []);
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

  return { actors, metrics, totals, plans, attributions, auditEvents, links, loading, error, reload };
}
