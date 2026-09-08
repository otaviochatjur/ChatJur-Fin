"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AsaasBaseState } from "@/lib/asaas-base";
import { isSyncConnectionError, syncErrorMessage } from "@/lib/sync-connection-error";

async function requestBase(body?: unknown) {
  const response = await fetch("/api/asaas/base-sync", { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Falha na sincronização.");
  return data.state as AsaasBaseState | null;
}
export function AsaasBaseSync({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<AsaasBaseState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const mounted = useRef(false), running = useRef(false), paused = useRef(false), changed = useRef(onChanged);
  useEffect(() => { changed.current = onChanged; }, [onChanged]);
  const synchronize = useCallback(async (force: boolean) => {
    if (running.current || (!force && paused.current)) return;
    running.current = true; paused.current = false; setBusy(true); setError("");
    try {
      let next = await requestBase({ action: "start", force });
      if (mounted.current) setState(next);
      while (mounted.current && !paused.current && next?.status === "RUNNING") {
        next = await requestBase({ action: "advance", generation: next.generation });
        if (mounted.current) setState(next);
      }
      if (mounted.current && next?.status === "READY") changed.current();
    } catch (e) { if (mounted.current) { paused.current = paused.current || !isSyncConnectionError(e); setError(syncErrorMessage(e)); } }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const check = async () => {
      if (running.current || paused.current || document.hidden) return;
      try {
        const current = await requestBase();
        if (!mounted.current) return;
        setState(current);
        setError("");
        if (!current || current.status === "RUNNING" || !current.completed_at || Date.now() - Date.parse(current.completed_at) >= 3600000) void synchronize(false);
      } catch (e) { if (mounted.current) setError(syncErrorMessage(e)); }
    };
    const manualSync = () => void synchronize(true);
    window.addEventListener("nexo:sync-asaas-base", manualSync);
    const reconnect = () => { if (!document.hidden) void check(); };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    void check(); const timer = setInterval(() => void check(), 60000);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener("nexo:sync-asaas-base", manualSync); window.removeEventListener("online", reconnect); document.removeEventListener("visibilitychange", reconnect); };
  }, [synchronize]);
  const phase = ["clientes", "cobranças", "links de pagamento"][state?.phase ?? 0];
  return <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm" aria-label="Base sincronizada do Asaas">
    <div><p className="font-medium">Base do Asaas · clientes, cobranças e links</p><p role="status" className="text-xs text-muted-foreground">{busy ? `Sincronizando ${phase ?? "base"} · ${state?.processed ?? 0} itens consultados` : state?.completed_at ? `Última conferência: ${new Date(state.completed_at).toLocaleString("pt-BR")}` : "A carga inicial prepara os relatórios rápidos."}{state?.last_event_at && ` · Último evento: ${new Date(state.last_event_at).toLocaleString("pt-BR")}`}</p><p className="text-xs text-muted-foreground">Conferência automática a cada hora enquanto o sistema está aberto. Os relatórios usam a última carga concluída.</p>{error && <p role="alert" className="mt-1 text-xs text-destructive">{error} O progresso salvo pode ser retomado.</p>}</div>
    {busy ? <Button variant="outline" size="sm" onClick={() => { paused.current = true; }}>Pausar após esta etapa</Button> : <Button variant="outline" size="sm" onClick={() => void synchronize(true)}>{state?.status === "RUNNING" ? "Retomar sincronização" : "Sincronizar agora"}</Button>}
  </section>;
}
