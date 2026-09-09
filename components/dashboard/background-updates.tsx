"use client";
import { useEffect, useState } from 'react';

export async function pollCollectionSchedule(wasEnabled = false) {
  let enabled = wasEnabled;
  try {
    const statusResponse = await fetch('/api/collections/schedule', { signal: AbortSignal.timeout(120000) });
    const status = await statusResponse.json();
    if (!statusResponse.ok) throw new Error(status.error ?? 'Falha ao consultar a programação.');
    enabled = status.config?.enabled === true;
    if (!enabled) return { enabled: false, active: false, error: '' };

    const response = await fetch('/api/collections/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tick' }), signal: AbortSignal.timeout(120000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Falha na programação.');
    return { enabled: true, active: data.active === true, error: '' };
  } catch (error) {
    return { enabled, active: false, error: enabled ? (error instanceof Error ? error.message : 'Falha na programação.') : '' };
  }
}

/** Mounted above section navigation, so changing sections never stops the scheduler. */
export function BackgroundUpdates({ onLeadsChanged }: { onLeadsChanged: () => Promise<void> }) {
  const [tallyError, setTallyError] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  useEffect(() => {
    let stopped = false, tallyBusy = false, scheduleBusy = false, scheduleEnabled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tally() {
      if (stopped || tallyBusy) return;
      tallyBusy = true;
      try {
        const response = await fetch('/api/tally/poll', { method: 'POST', signal: AbortSignal.timeout(120000) });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error ?? 'Falha na sincronização.');
        if (!stopped) { setTallyError(''); await onLeadsChanged(); }
      } catch (error) { if (!stopped) setTallyError(error instanceof Error ? error.message : 'Falha ao atualizar Tally.'); }
      finally { tallyBusy = false; }
    }
    async function schedule() {
      if (stopped || scheduleBusy) return;
      scheduleBusy = true;
      let active = false;
      try {
        const result = await pollCollectionSchedule(scheduleEnabled);
        scheduleEnabled = result.enabled;
        active = result.active;
        if (!stopped) setScheduleError(result.error);
      } catch { if (!stopped && scheduleEnabled) setScheduleError('Falha na programação.'); }
      finally { scheduleBusy = false; if (!stopped) timer = setTimeout(() => void schedule(), active ? 1500 : 60000); }
    }
    void tally(); void schedule();
    const interval = setInterval(() => void tally(), 60000);
    const refresh = () => { clearTimeout(timer); void schedule(); void tally(); };
    window.addEventListener('nexo:programming-changed', refresh);
    return () => { stopped = true; clearInterval(interval); clearTimeout(timer); window.removeEventListener('nexo:programming-changed', refresh); };
  }, [onLeadsChanged]);
  if (!tallyError && !scheduleError) return null;
  return <div role="status" className="rounded-xl bg-amber-500/10 p-3 text-sm">{tallyError && <p>Tally: {tallyError}</p>}{scheduleError && <p>Programação de cobranças: {scheduleError} Consulte a aba Cobranças → Programação.</p>}</div>;
}
