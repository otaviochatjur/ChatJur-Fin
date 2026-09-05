import { listAsaasPaymentsForLink, type AsaasPayment } from "@/lib/asaas";
import { syncAsaasPayment } from "@/lib/payment-sync";
import { supabaseRequest } from "@/lib/supabase-server";

type PaymentLinkRow = { id: string; asaas_payment_link_id: string | null };

async function syncOneLink(link: PaymentLinkRow) {
  if (!link.asaas_payment_link_id) return { linkId: link.id, payments: 0, skipped: 0 };
  let offset = 0;
  let total = 0;
  let skipped = 0;
  while (true) {
    const page = await listAsaasPaymentsForLink(link.asaas_payment_link_id, offset);
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
  return { linkId: link.id, payments: total, skipped };
}

/**
 * Backup path for real payment tracking: pulls every payment already made
 * through Asaas payment links and reflects it into customers/subscriptions/
 * payments, using the same idempotent logic as the webhook. Useful for a
 * manual "Sincronizar pagamentos" refresh and for backfilling anything that
 * happened before the webhook was registered.
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({})) as { actorId?: string; linkId?: string };
    const filters = [
      "select=id,asaas_payment_link_id",
      "asaas_payment_link_id=not.is.null",
      payload.linkId ? `id=eq.${encodeURIComponent(payload.linkId)}` : null,
      payload.actorId ? `actor_id=eq.${encodeURIComponent(payload.actorId)}` : null,
    ].filter(Boolean).join("&");

    const links = await supabaseRequest<PaymentLinkRow[]>(`/rest/v1/payment_links?${filters}`);
    const results = [];
    for (const link of links) {
      results.push(await syncOneLink(link));
    }
    const totalPayments = results.reduce((sum, item) => sum + item.payments, 0);
    const totalSkipped = results.reduce((sum, item) => sum + item.skipped, 0);
    return Response.json({ links: results.length, payments: totalPayments, skipped: totalSkipped });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao sincronizar pagamentos." }, { status: 500 });
  }
}
