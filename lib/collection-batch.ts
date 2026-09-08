import type { CollectionPreview } from "./collection-policy";

export function selectedCollectionPreviews(rows: CollectionPreview[], selected: Set<string>, results: Record<string, string>) {
  return rows.filter(row => selected.has(row.payment.id) && !row.blocked && row.approval && !results[row.payment.id]);
}

/** Freeze the approved selection, send sequentially, and stop on an uncertain result. */
export async function runCollectionBatch(rows: CollectionPreview[], send: (row: CollectionPreview) => Promise<{ ok: boolean; message: string }>, onResult: (row: CollectionPreview, result: { ok: boolean; message: string }, completed: number) => void, cancelled: () => boolean) {
  let completed = 0;
  for (const row of rows) {
    if (cancelled()) break;
    let result;
    try { result = await send(row); }
    catch { result = { ok: false, message: "Resposta não confirmada. Consulte o histórico antes de repetir." }; }
    onResult(row, result, ++completed);
    if (!result.ok) break;
  }
  return completed;
}

/** Report checkboxes use Asaas IDs; the dispatch endpoint uses Chat Jurídico IDs. */
export function selectedChatPaymentIds(rows: CollectionPreview[], asaasIds: Set<string>) {
  return new Set(rows.filter(row => asaasIds.has(row.payment.asaas_payment_id ?? row.payment.id)).map(row => row.payment.id));
}
