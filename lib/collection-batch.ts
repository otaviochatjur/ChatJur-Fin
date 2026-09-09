import type { CollectionPreview } from "./collection-policy";

export type CollectionBatchResult = { ok: boolean; message: string; continueBatch?: boolean; retryAfterMs?: number };

export function selectedCollectionPreviews(rows: CollectionPreview[], selected: Set<string>, results: Record<string, string>) {
  return rows.filter(row => selected.has(row.payment.id) && !row.blocked && row.approval && !results[row.payment.id]);
}

/** Freeze the approved selection, pace template sends, and stop only on an uncertain result. */
export async function runCollectionBatch(rows: CollectionPreview[], send: (row: CollectionPreview) => Promise<CollectionBatchResult>, onResult: (row: CollectionPreview, result: CollectionBatchResult, completed: number) => void, cancelled: () => boolean, options: { minimumIntervalMs?: number; now?: () => number; wait?: (milliseconds: number) => Promise<void> } = {}) {
  let completed = 0;
  let lastStartedAt: number | null = null;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  for (const row of rows) {
    if (cancelled()) break;
    if (lastStartedAt !== null && options.minimumIntervalMs) {
      const delay = options.minimumIntervalMs - (now() - lastStartedAt);
      if (delay > 0) await wait(delay);
      if (cancelled()) break;
    }
    lastStartedAt = now();
    let result: CollectionBatchResult;
    try { result = await send(row); }
    catch { result = { ok: false, message: "Resposta não confirmada. Consulte o histórico antes de repetir." }; }
    onResult(row, result, ++completed);
    if (!result.ok && !result.continueBatch) break;
  }
  return completed;
}

/** Report checkboxes use Asaas IDs; the dispatch endpoint uses Chat Jurídico IDs. */
export function selectedChatPaymentIds(rows: CollectionPreview[], asaasIds: Set<string>) {
  return new Set(rows.filter(row => asaasIds.has(row.payment.asaas_payment_id ?? row.payment.id)).map(row => row.payment.id));
}
