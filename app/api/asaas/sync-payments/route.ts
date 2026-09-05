import { listAsaasPaymentsForLink, type AsaasPayment } from "@/lib/asaas";
import { syncAsaasPayment } from "@/lib/payment-sync";
import { supabaseRequest } from "@/lib/supabase-server";

type PaymentLinkRow = { id: string; asaas_payment_link_id: string | null; last_synced_at: string | null };

// Small backward overlap on every *incremental* sync so a payment created a
// few seconds before the previous run's cutoff (clock skew, in-flight
// webhook, etc.) never falls in a gap between two syncs. Irrelevant for a
// link's first (full-history) sync.
const OVERLAP_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

async function syncOneLink(link: PaymentLinkRow) {
  if (!link.asaas_payment_link_id) return { linkId: link.id, payments: 0, skipped: 0 };
  const since = link.last_synced_at ? new Date(new Date(link.last_synced_at).getTime() - OVERLAP_MS).toISOString().slice(0, 10) : undefined;
  const startedAt = new Date().toISOString();
  let offset = 0;
  let total = 0;
  let skipped = 0;
  while (true) {
    const page = await listAsaasPaymentsForLink(link.asaas_payment_link_id, offset, since);
    for (const payment of page.data) {
      // Asaas's `paymentLink` filter isn't fully reliable in the sandbox, so
      // syncAsaasPayment re-checks that each payment really belongs to this
      // link before writing anything — unrelated payments are skipped, not
      // ingested. See lib/payment-sync.ts.
      const outcome = await syncAsaasPayment(payment as AsaasPayment);
      if (outcome.result === "skipped") skipped += 1; else total += 1;
    }
    if (!page.hasMore) break;
    offset += page.data.length;
  }
  // Recorded as "everything up to when this link's scan *started*" (not
  // when it finished) so a payment that lands mid-scan is never missed —
  // the next sync's overlap window will still pick it up.
  await supabaseRequest(`/rest/v1/payment_links?id=eq.${link.id}`, { method: "PATCH", body: { last_synced_at: startedAt } });
  return { linkId: link.id, payments: total, skipped };
}

/**
 * Backup path for real payment tracking: pulls every payment already made
 * through Asaas payment links and reflects it into customers/subscriptions/
 * payments, using the same idempotent logic as the webhook. Useful for a
 * manual "Sincronizar pagamentos" refresh and for backfilling anything that
 * happened before the webhook was registered.
 *
 * Incremental after the first run (see `last_synced_at` on payment_links):
 * some links here have thousands of historical payments (a shared/generic
 * link reused by many clients over time) — re-walking that full history on
 * every click made the whole sync take many minutes with zero feedback,
 * which read as "not working". Each link is also isolated in its own
 * try/catch so one slow/failing link can't abort the rest of the batch —
 * failures come back in `errors` instead of a single opaque 500.
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({})) as { actorId?: string; linkId?: string };
    const filters = [
      "select=id,asaas_payment_link_id,last_synced_at",
      "asaas_payment_link_id=not.is.null",
      payload.linkId ? `id=eq.${encodeURIComponent(payload.linkId)}` : null,
      payload.actorId ? `actor_id=eq.${encodeURIComponent(payload.actorId)}` : null,
    ].filter(Boolean).join("&");

    const links = await supabaseRequest<PaymentLinkRow[]>(`/rest/v1/payment_links?${filters}`);
    const results: { linkId: string; payments: number; skipped: number }[] = [];
    const errors: { linkId: string; message: string }[] = [];
    for (const link of links) {
      try {
        results.push(await syncOneLink(link));
      } catch (error) {
        errors.push({ linkId: link.id, message: error instanceof Error ? error.message : "Erro desconhecido." });
      }
    }
    const totalPayments = results.reduce((sum, item) => sum + item.payments, 0);
    const totalSkipped = results.reduce((sum, item) => sum + item.skipped, 0);
    return Response.json({ links: results.length, payments: totalPayments, skipped: totalSkipped, errors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao sincronizar pagamentos." }, { status: 500 });
  }
}
