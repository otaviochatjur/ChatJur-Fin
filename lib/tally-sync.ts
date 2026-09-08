import { supabaseRequest } from "@/lib/supabase-server";
import { mapTallyFieldsToLead, type TallyField } from "@/lib/tally-mapping";

type TallyQuestion = { id: string; title: string };
type TallyResponse = { questionId: string; answer: unknown };
type TallySubmission = { id: string; formId: string; submittedAt: string; isCompleted?: boolean; responses: TallyResponse[] };
type TallySubmissionsPage = { hasMore: boolean; questions: TallyQuestion[]; submissions: TallySubmission[] };

async function fetchTallyPage(apiKey: string, formId: string, page: number): Promise<TallySubmissionsPage> {
  const response = await fetch(`https://api.tally.so/forms/${encodeURIComponent(formId)}/submissions?page=${page}&limit=100&filter=completed`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "manual", signal: AbortSignal.timeout(20000), cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Chave de API do Tally inválida ou expirada.");
    if (response.status === 404) throw new Error("Formulário não encontrado no Tally. Confira o identificador.");
    throw new Error(`O Tally respondeu ${response.status}.`);
  }
  const data = await response.json();
  if (!Array.isArray(data.questions) || !Array.isArray(data.submissions) || typeof data.hasMore !== "boolean" || (data.hasMore && !data.submissions.length)) throw new Error("O Tally retornou uma página incompleta. Tente sincronizar novamente.");
  return data;
}

/** Confirms an API key + form id combination actually works, without importing anything — used when saving the integration so a typo surfaces immediately instead of silently failing on the next sync. */
export async function validateTallyKey(apiKey: string, formId: string) {
  await fetchTallyPage(apiKey, formId, 1);
}

/**
 * Pulls every submission of a Tally form via its REST API (an account-level
 * personal access token — Tally > Settings > API keys — not the older
 * per-webhook signing secret) and reflects new ones into `connect_leads`.
 * This is the same "pull, don't wait to be pushed to" shape as
 * `lib/payment-sync.ts`'s manual "Sincronizar pagamentos" for Asaas: the
 * candidaturas pipeline depends only on the stored API key, never on a
 * webhook being registered inside Tally's own dashboard.
 *
 * Idempotent — skips any submission whose id is already present as
 * `tally_submission_id` (tenant-scoped automatically by `supabaseRequest`).
 */
export async function syncTallySubmissions(apiKey: string, formId: string) {
  let page = 1;
  let hasMore = true;
  let questionTitleById: Map<string, string> | null = null;
  let scanned = 0;
  let imported = 0;
  let skipped = 0;

  while (hasMore) {
    const data = await fetchTallyPage(apiKey, formId, page);
    if (!questionTitleById) questionTitleById = new Map(data.questions.map((question) => [question.id, question.title]));

    for (const submission of data.submissions) {
      scanned += 1;
      if (submission.isCompleted === false) { skipped += 1; continue; }
      const existing = await supabaseRequest<{ id: string }[]>(
        `/rest/v1/connect_leads?select=id&tally_submission_id=eq.${encodeURIComponent(submission.id)}`,
      );
      if (existing[0]) { skipped += 1; continue; }

      const fields: TallyField[] = submission.responses.map((response) => ({
        label: questionTitleById!.get(response.questionId) ?? response.questionId,
        value: response.answer,
      }));
      const mapped = mapTallyFieldsToLead(fields);
      const inserted = await supabaseRequest<{ id: string }[]>("/rest/v1/connect_leads?on_conflict=tenant_id,tally_submission_id", {
        prefer: "resolution=ignore-duplicates,return=representation",
        method: "POST",
        body: {
          tally_submission_id: submission.id,
          tally_response_id: null,
          tally_form_id: submission.formId ?? formId,
          submitted_at: submission.submittedAt,
          raw_payload: { source: "api_sync", submission, fields },
          ...mapped,
        },
      });
      if (inserted?.length) imported += 1; else skipped += 1;
    }

    hasMore = data.hasMore;
    page += 1;
  }

  return { scanned, imported, skipped };
}
