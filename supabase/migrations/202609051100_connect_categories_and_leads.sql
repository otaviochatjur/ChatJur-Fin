-- Chat Jurídico Connect: introduces the official partner-program taxonomy
-- (Parceiro, Parceiro Plus, Embaixador, Institucional) per the internal
-- policy doc, plus the lead-intake pipeline fed by the public Tally
-- application form (embedded in the Connect page and mirrored here via
-- webhook so every submission is trackable/actionable in the CRM).
--
-- Categories (see Chat_Juridico_Connect_Politica_Interna):
--   - Parceiro / Parceiro Plus: same role (PARTNER), "tier" distinguishes
--     them (Plus = 5+ active plans sold, promoted manually by staff).
--   - Embaixador: new-ish role, unchanged (AMBASSADOR).
--   - Institucional: brand-new role (INSTITUTIONAL) — OABs, associações,
--     universidades etc. with a formal relationship with Chat Jurídico.
-- "Comercial interno/externo" are a separate, unrelated grouping (plain
-- sales staff, not part of the Connect program) and are untouched here.
--
-- Every statement is written to be safely re-runnable.

alter table public.commercial_actors drop constraint if exists commercial_actors_role_check;
alter table public.commercial_actors add constraint commercial_actors_role_check
  check (role in ('PARTNER', 'AMBASSADOR', 'EXTERNAL_SALES', 'INTERNAL_SALES', 'INSTITUTIONAL'));

-- Only meaningful for role = 'PARTNER' (Parceiro vs Parceiro Plus, 10% vs
-- 15% recurring return per the policy) — null/'STANDARD' for every other
-- role.
alter table public.commercial_actors add column if not exists tier text not null default 'STANDARD'
  check (tier in ('STANDARD', 'PLUS'));

-- Social links, collected by the Connect application form and requested
-- explicitly for the partner's profile (co-marketing, content collabs...).
alter table public.commercial_actors add column if not exists instagram text;
alter table public.commercial_actors add column if not exists linkedin text;
alter table public.commercial_actors add column if not exists youtube text;
alter table public.commercial_actors add column if not exists tiktok text;
alter table public.commercial_actors add column if not exists twitter_x text;
alter table public.commercial_actors add column if not exists website text;

comment on column public.commercial_actors.tier is
  'Parceiro (STANDARD, 10% de retorno) vs Parceiro Plus (PLUS, 15%, critério: 5+ planos vendidos e ativos). Só relevante para role = PARTNER; promoção é manual via painel.';

-- Seed the official default (category-wide) commission rate for every
-- actor that doesn't already have one configured — existing custom
-- defaults are left untouched. Parceiro Plus actors get 15% instead of
-- 10% (there shouldn't be any yet since `tier` just defaulted everyone to
-- STANDARD above, but this keeps the seed correct if tiers are set before
-- this statement runs in some future replay).
insert into public.actor_commission_rates (actor_id, plan_id, custom_plan_id, rate_percent)
select a.id, null, null,
  case
    when a.role = 'PARTNER' and a.tier = 'PLUS' then 15
    when a.role = 'PARTNER' then 10
    when a.role = 'AMBASSADOR' then 15
    when a.role = 'INSTITUTIONAL' then 10
  end
from public.commercial_actors a
where a.role in ('PARTNER', 'AMBASSADOR', 'INSTITUTIONAL')
  and not exists (
    select 1 from public.actor_commission_rates r
    where r.actor_id = a.id and r.plan_id is null and r.custom_plan_id is null
  );

-- Lead intake from the public "Chat Jurídico Connect" Tally form (embedded
-- in the Connect page). The form does NOT ask the candidate to pick a
-- category — every submission lands here as PENDING and a human classifies
-- it as Parceiro / Embaixador / Institucional from the review screen,
-- which is also what creates the corresponding commercial_actors row.
create table if not exists public.connect_leads (
  id uuid primary key default gen_random_uuid(),

  -- Idempotency: Tally may redeliver the same webhook.
  tally_submission_id text unique,
  tally_response_id text,
  tally_form_id text,

  -- Identificação
  full_name text,
  email text,
  whatsapp text,
  applicant_type text, -- 'INDIVIDUAL' | 'COMPANY' | 'INSTITUTION' (raw label kept as-is from Tally; not constrained, mapping can drift)

  -- Pessoa física
  cpf text,
  birth_date date,
  profession text,
  company_name text,
  job_title text,

  -- Empresa (razão social / nome fantasia / CNPJ / representante)
  company_legal_name text,
  company_trade_name text,
  company_cnpj text,
  company_rep_name text,
  company_rep_cpf text,
  company_rep_role text,

  -- Instituição
  institution_name text,
  institution_legal_name text,
  institution_cnpj text,
  institution_type text, -- OAB/subseção, associação, faculdade/universidade, entidade de classe, comunidade, outra
  institution_rep_name text,
  institution_rep_role text,
  institution_member_count text,
  institution_scope text, -- municipal/regional/estadual/nacional/internacional
  institution_actions text,

  -- Endereço
  address_zip text,
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_state text,

  -- Atuação e conexão com o Chat Jurídico
  activity_area text,
  activity_description text,
  works_with_legal_market text, -- sim/não/parcialmente
  connection_types text[], -- seleção múltipla (indicação, agência, consultoria, conteúdo, eventos, institucional, tecnologia...)
  relationship_with_offices text, -- sim frequentemente / ocasionalmente / não
  office_network_size text, -- faixa
  already_refers_tools text,
  already_refers_tools_details text,
  has_own_clients_that_benefit text, -- sim/não/talvez

  -- Redes e audiência
  instagram text,
  linkedin text,
  youtube text,
  tiktok text,
  twitter_x text,
  website text,
  other_social text,
  main_channel text,
  main_channel_audience_size text,
  audience_description text,
  produces_content_regularly text, -- sim/não/ocasionalmente
  content_formats text[],
  collab_interest text, -- sim/talvez/não
  participates_in_events text,
  participates_in_events_details text,

  -- Motivação (obrigatórias)
  motivation_why text,
  motivation_success_view text,

  -- Dados de pagamento
  payee_type text, -- pessoa física / jurídica
  payee_name text,
  payee_document text,
  pix_key_type text,
  pix_key text,

  -- Consentimentos (3 checkboxes do formulário)
  consent_flags jsonb,

  -- Fallback: full raw Tally payload, so nothing is lost if a field isn't
  -- mapped above or the form changes.
  raw_payload jsonb,

  -- Revisão/classificação
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  classified_as text check (classified_as is null or classified_as in ('PARTNER', 'AMBASSADOR', 'INSTITUTIONAL')),
  linked_actor_id uuid references public.commercial_actors(id),
  reviewed_at timestamptz,
  reviewed_notes text,

  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists connect_leads_status_idx on public.connect_leads (status, created_at desc);
create index if not exists connect_leads_linked_actor_idx on public.connect_leads (linked_actor_id);

drop trigger if exists connect_leads_set_updated_at on public.connect_leads;
create trigger connect_leads_set_updated_at before update on public.connect_leads
for each row execute function public.set_updated_at();

alter table public.connect_leads enable row level security;
drop policy if exists "authenticated_read_connect_leads" on public.connect_leads;
create policy "authenticated_read_connect_leads" on public.connect_leads for select to authenticated using (true);

comment on table public.connect_leads is
  'Candidaturas recebidas pelo formulário público "Chat Jurídico Connect" (Tally), via webhook. O formulário não pergunta a categoria — a classificação (Parceiro/Embaixador/Institucional) e a criação do commercial_actor correspondente são feitas manualmente na tela de revisão do painel.';
comment on column public.connect_leads.raw_payload is
  'Corpo bruto do webhook do Tally (fields[]), preservado por completo como fallback caso o mapeamento de algum campo específico mude ou falhe.';
