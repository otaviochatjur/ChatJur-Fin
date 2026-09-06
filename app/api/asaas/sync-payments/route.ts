import { listAsaasPayments } from "@/lib/asaas";
import { syncAsaasPayment } from "@/lib/payment-sync";
import { supabaseRequest } from "@/lib/supabase-server";

// Small backward overlap on every incremental sync so a payment created a
// few seconds before the previous run's cutoff (clock skew, in-flight
// webhook, etc.) never falls in a gap between two syncs.
const OVERLAP_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

type LastRun = { action: "COMPLETED" | "FAILED"; after_json: { startedAt?: string } | null };

/** Watermark = the `startedAt` of the last successful full-account sync, so an incremental run only walks what's new since then. Read from `audit_events` (see `logSyncRun`) rather than a dedicated column — one global cursor, not per-link. */
async function resolveSince(): Promise<string | undefined> {
  const rows = await supabaseRequest<LastRun[]>(
    "/rest/v1/audit_events?select=action,after_json&entity_type=eq.payment_sync&action=eq.COMPLETED&order=created_at.desc&limit=1",
  );
  const startedAt = rows[0]?.after_json?.startedAt;
  if (!startedAt) return undefined;
  return new Date(new Date(startedAt).getTime() - OVERLAP_MS).toISOString().slice(0, 10);
}

/**
 * One row per "Sincronizar pagamentos" run in `audit_events` (entity_type
 * "payment_sync") — this is both the audit trail the UI reads to show
 * "última sincronização" and, via `resolveSince` above, the watermark that
 * makes the next run incremental.
 */
async function logSyncRun(scope: string, status: "COMPLETED" | "FAILED", details: Record<string, unknown>) {
  try {
    await supabaseRequest("/rest/v1/audit_events", {
      method: "POST",
      body: { entity_type: "payment_sync", entity_id: scope, action: status, after_json: details },
    });
  } catch {
    // Best-effort logging — never let a logging failure mask the sync's own result.
  }
}

/**
 * Backup path for real payment tracking: pulls payments made through Asaas
 * payment links and reflects them into customers/subscriptions/payments,
 * using the same idempotent logic as the webhook. Useful for a manual
 * "Sincronizar pagamentos" refresh and for backfilling anything that
 * happened before the webhook was registered.
 *
 * Walks the account's payments ONE time (not once per link — see
 * `listAsaasPayments`), incrementally after the first run. An optional
 * `linkId`/`actorId` in the body only narrows which of the returned
 * payments get persisted (everything else is still fetched, since Asaas
 * can't filter server-side) — mainly useful to re-check one troublesome
 * link without waiting for `onChanged` to refetch everything else.
 */
export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  const payload = await request.json().catch(() => ({})) as { actorId?: string; linkId?: string };
  const scope = payload.linkId ? `link:${payload.linkId}` : payload.actorId ? `actor:${payload.actorId}` : "all";
  try {
    let allowedAsaasLinkIds: Set<string> | null = null;
    if (payload.linkId || payload.actorId) {
      const filters = [
        "select=asaas_payment_link_id",
        "asaas_payment_link_id=not.is.null",
        payload.linkId ? `id=eq.${encodeURIComponent(payload.linkId)}` : null,
        payload.actorId ? `actor_id=eq.${encodeURIComponent(payload.actorId)}` : null,
      ].filter(Boolean).join("&");
      const rows = await supabaseRequest<{ asaas_payment_link_id: string }[]>(`/rest/v1/payment_links?${filters}`);
      allowedAsaasLinkIds = new Set(rows.map((row) => row.asaas_payment_link_id));
    }

    const since = await resolveSince();
    let offset = 0;
    let synced = 0;
    let skipped = 0;
    let scanned = 0;
    const touchedLinkIds = new Set<string>();
    while (true) {
      const page = await listAsaasPayments(offset, since);
      for (const payment of page.data) {
        scanned += 1;
        if (allowedAsaasLinkIds && (!payment.paymentLink || !allowedAsaasLinkIds.has(payment.paymentLink))) continue;
        const outcome = await syncAsaasPayment(payment);
        if (outcome.result === "skipped") { skipped += 1; continue; }
        synced += 1;
        // Orphan payments (no paymentLink, migrated straight in Asaas — see
        // lib/payment-sync.ts) can resolve to a subscription that itself
        // has no payment_link_id; nothing to add to the touched-links count.
        if (outcome.linkId) touchedLinkIds.add(outcome.linkId);
      }
      if (!page.hasMore) break;
      offset += page.data.length;
    }

    await logSyncRun(scope, "COMPLETED", { startedAt, finishedAt: new Date().toISOString(), scanned, payments: synced, skipped, since: since ?? "full-history" });
    // `links` kept in the response for the existing UI copy ("N pagamentos de M links") — every synced payment already carries its own link, so this is just the count of distinct ones touched.
    return Response.json({ links: touchedLinkIds.size, payments: synced, skipped, scanned, errors: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao sincronizar pagamentos.";
    await logSyncRun(scope, "FAILED", { startedAt, finishedAt: new Date().toISOString(), error: message });
    return Response.json({ error: message }, { status: 500 });
  }
}
