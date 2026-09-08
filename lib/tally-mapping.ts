export type TallyOption = { id?: string; text?: string; label?: string };
export type TallyField = { key?: string; label?: string; type?: string; value?: unknown; options?: TallyOption[] };

function normalizeLabel(label: string) {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** Resolves a field's value to its human-readable option label(s), when the field carries an `options` list (multiple-choice/checkboxes/dropdown). */
function resolveOptionLabels(field: TallyField): string[] {
  const raw = field.value;
  const values = Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === "" ? [] : [raw];
  if (!field.options?.length) return values.map((v) => String(v));
  return values.map((v) => {
    const option = field.options!.find((o) => o.id === v || o.text === v || o.label === v);
    return option?.text ?? option?.label ?? String(v);
  });
}

type Rule = { column: string; kind: "single" | "array" | "consent"; test: (label: string) => boolean };

/**
 * Best-effort label → column mapping. Tally's exact question wording isn't
 * guaranteed to stay stable (staff can reword questions in the Tally editor
 * without touching this code), so this is intentionally heuristic — ordered
 * from most-specific to most-generic so composite questions (e.g. "CPF do
 * representante") aren't swallowed by a generic rule (e.g. "CPF") checked
 * later. Every submission's full `raw_payload` is preserved regardless of
 * mapping outcome, so nothing is ever lost even if a specific rule below
 * needs adjusting after a real submission comes in.
 *
 * Shared by the ongoing API sync (`lib/tally-sync.ts`) and the one-off
 * historical backfill (`scripts/legacy-import/import-tally-submissions.mjs`)
 * so both paths classify a given question exactly the same way.
 */
const RULES: Rule[] = [
  { column: "whatsapp", kind: "single", test: (l) => l.includes("whatsapp") },
  { column: "email", kind: "single", test: (l) => l.includes("e-mail") || l.includes("email") },
  { column: "applicant_type", kind: "single", test: (l) => l.includes("tipo de candidat") },

  { column: "birth_date", kind: "single", test: (l) => l.includes("nascimento") },
  { column: "profession", kind: "single", test: (l) => l.includes("profiss") },

  // Payee (dados de pagamento) — checked before the generic cpf/cnpj/nome rules below.
  { column: "payee_type", kind: "single", test: (l) => l.includes("tipo de recebedor") },
  { column: "payee_name", kind: "single", test: (l) => l.includes("recebedor") && (l.includes("nome") || l.includes("razao social")) },
  { column: "payee_document", kind: "single", test: (l) => l.includes("recebedor") && (l.includes("cpf") || l.includes("cnpj")) },
  { column: "pix_key_type", kind: "single", test: (l) => l.includes("tipo") && l.includes("pix") },
  { column: "pix_key", kind: "single", test: (l) => l.includes("chave pix") },

  // Representante da empresa — checked before generic cpf/cargo/nome rules.
  { column: "company_rep_cpf", kind: "single", test: (l) => l.includes("representante") && l.includes("cpf") },
  { column: "company_rep_role", kind: "single", test: (l) => l.includes("representante") && l.includes("cargo") },
  { column: "company_rep_name", kind: "single", test: (l) => l.includes("representante") && l.includes("nome") },

  // Instituição — checked before generic cargo/nome/numero rules.
  { column: "institution_type", kind: "single", test: (l) => l.includes("tipo de instituic") },
  { column: "institution_rep_role", kind: "single", test: (l) => l.includes("institu") && l.includes("cargo") },
  { column: "institution_rep_name", kind: "single", test: (l) => l.includes("institu") && l.includes("representante") && l.includes("nome") },
  { column: "institution_cnpj", kind: "single", test: (l) => l.includes("institu") && l.includes("cnpj") },
  { column: "institution_legal_name", kind: "single", test: (l) => l.includes("institu") && (l.includes("razao social")) },
  { column: "institution_name", kind: "single", test: (l) => l.includes("nome da instituic") },
  { column: "institution_member_count", kind: "single", test: (l) => l.includes("membro") },
  { column: "institution_scope", kind: "single", test: (l) => l.includes("abrangenc") },
  { column: "institution_actions", kind: "single", test: (l) => l.includes("acoes") && (l.includes("realizad") || l.includes("institu")) },

  // Generic "nome completo" catch-all — must come after every more-specific
  // name rule above (payee, representante, instituição): those questions'
  // labels also often contain the substring "nome completo" (e.g. "Nome
  // completo ou Razão Social do recebedor"), so checking this first would
  // let a later, unrelated question (e.g. the payee's name) silently
  // overwrite the applicant's own name.
  { column: "full_name", kind: "single", test: (l) => l.includes("nome completo") || l === "nome" || l === "seu nome" },

  { column: "cpf", kind: "single", test: (l) => l === "cpf" || (l.includes("cpf") && !l.includes("cnpj")) },

  // Empresa
  { column: "company_trade_name", kind: "single", test: (l) => l.includes("fantasia") },
  { column: "company_legal_name", kind: "single", test: (l) => l.includes("razao social") },
  { column: "company_cnpj", kind: "single", test: (l) => l.includes("cnpj") },
  { column: "job_title", kind: "single", test: (l) => l.includes("cargo") },
  { column: "company_name", kind: "single", test: (l) => l.includes("nome da empresa") || l === "empresa" },

  // Endereço
  { column: "address_zip", kind: "single", test: (l) => l.includes("cep") },
  { column: "address_street", kind: "single", test: (l) => l.includes("logradouro") || l === "rua" },
  { column: "address_complement", kind: "single", test: (l) => l.includes("complemento") },
  { column: "address_neighborhood", kind: "single", test: (l) => l.includes("bairro") },
  { column: "address_city", kind: "single", test: (l) => l.includes("cidade") },
  { column: "address_state", kind: "single", test: (l) => l.includes("estado") || l === "uf" },
  { column: "address_number", kind: "single", test: (l) => l.includes("numero") },

  // Atuação e conexão
  { column: "works_with_legal_market", kind: "single", test: (l) => l.includes("mercado juridic") },
  { column: "connection_types", kind: "array", test: (l) => l.includes("forma") && l.includes("conex") },
  { column: "relationship_with_offices", kind: "single", test: (l) => l.includes("relacionamento") && l.includes("escritorio") },
  { column: "office_network_size", kind: "single", test: (l) => l.includes("rede") && (l.includes("escritorio") || l.includes("profission")) },
  { column: "already_refers_tools_details", kind: "single", test: (l) => l.includes("ferramenta") && (l.includes("qual") || l.includes("descreva")) },
  { column: "already_refers_tools", kind: "single", test: (l) => l.includes("ferramenta") || l.includes("software") },
  { column: "has_own_clients_that_benefit", kind: "single", test: (l) => l.includes("clientes") && (l.includes("proprio") || l.includes("beneficiari")) },
  { column: "activity_description", kind: "single", test: (l) => l.includes("descri") && l.includes("atuac") },
  { column: "activity_area", kind: "single", test: (l) => l.includes("area de atuac") },

  // Redes e audiência
  { column: "instagram", kind: "single", test: (l) => l.includes("instagram") },
  { column: "linkedin", kind: "single", test: (l) => l.includes("linkedin") },
  { column: "youtube", kind: "single", test: (l) => l.includes("youtube") },
  { column: "tiktok", kind: "single", test: (l) => l.includes("tiktok") },
  { column: "twitter_x", kind: "single", test: (l) => l.includes("twitter") || l === "x" || l.includes("(x)") },
  { column: "other_social", kind: "single", test: (l) => l.includes("outra rede") },
  { column: "website", kind: "single", test: (l) => l.includes("site") || l.includes("blog") || l.includes("website") },
  { column: "main_channel_audience_size", kind: "single", test: (l) => l.includes("tamanho") && (l.includes("audiencia") || l.includes("canal")) },
  { column: "main_channel", kind: "single", test: (l) => l.includes("canal principal") },
  { column: "audience_description", kind: "single", test: (l) => l.includes("publico") && l.includes("audiencia") },
  { column: "produces_content_regularly", kind: "single", test: (l) => l.includes("produz") && l.includes("conteudo") },
  { column: "content_formats", kind: "array", test: (l) => l.includes("formato") && l.includes("conteudo") },
  { column: "collab_interest", kind: "single", test: (l) => l.includes("collab") || l.includes("colabora") },
  { column: "participates_in_events_details", kind: "single", test: (l) => l.includes("evento") && (l.includes("qual") || l.includes("descreva")) },
  { column: "participates_in_events", kind: "single", test: (l) => l.includes("evento") && l.includes("juridic") },

  // Motivação
  { column: "motivation_success_view", kind: "single", test: (l) => l.includes("parceria de sucesso") || (l.includes("imagina") && l.includes("parceria")) },
  { column: "motivation_why", kind: "single", test: (l) => l.includes("por que") && l.includes("participar") },

  // Consentimentos (checkboxes de ciência/concordância no fim do formulário)
  { column: "consent_flags", kind: "consent", test: (l) => l.includes("concordo") || l.includes("autorizo") || l.includes("ciente") || l.includes("declaro") },
];

export function mapTallyFieldsToLead(fields: TallyField[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  const consentFlags: Record<string, boolean> = {};

  for (const field of fields) {
    const label = normalizeLabel(field.label ?? field.key ?? "");
    if (!label) continue;
    const rule = RULES.find((candidate) => candidate.test(label));
    if (!rule) continue;

    if (rule.kind === "array") {
      record[rule.column] = resolveOptionLabels(field);
    } else if (rule.kind === "consent") {
      const value = field.value;
      consentFlags[field.label ?? field.key ?? "consentimento"] = value === true || value === "true" || (Array.isArray(value) && value.length > 0);
    } else {
      const labels = resolveOptionLabels(field);
      if (labels.length > 0) record[rule.column] = labels.join(", ");
    }
  }

  if (Object.keys(consentFlags).length > 0) record.consent_flags = consentFlags;
  return record;
}
