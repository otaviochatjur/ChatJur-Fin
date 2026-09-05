-- Full client CRM + real Asaas payment tracking.
--
-- Today revenue/MRR is measured from the *face value* of generated payment
-- links, and clients only exist if someone manually fills the "Atribuir
-- cliente" form. This migration adds the tables needed to track what
-- customers actually paid (via Asaas webhooks/sync) and to hold a real
-- client roster imported from the historical spreadsheets.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  external_office_id text unique,
  office_name text not null,
  responsible_name text,
  email text,
  phone text,
  city text,
  state text,
  service_area text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED', 'FROZEN')),
  onboarding_completed boolean not null default false,
  source_channel text,
  acquisition_actor_id uuid references public.commercial_actors(id),
  asaas_customer_id text unique,
  signed_at date,
  cancelled_at date,
  cancellation_category text,
  cancellation_reason text,
  comments text,
  implementation_date date,
  implementation_value numeric(12,2),
  api_oficial boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_acquisition_actor_idx on public.customers (acquisition_actor_id);
create index customers_status_idx on public.customers (status);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  plan_id uuid references public.plans(id),
  custom_plan_id uuid references public.actor_custom_plans(id),
  plan_name_raw text,
  payment_link_id uuid references public.payment_links(id),
  actor_id uuid references public.commercial_actors(id),
  billing_period text not null check (billing_period in ('MONTHLY', 'ANNUAL')),
  value numeric(12,2) not null check (value >= 0),
  payment_method text,
  installments integer,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED', 'FROZEN')),
  asaas_subscription_id text,
  asaas_installment_id text,
  started_at date,
  cancelled_at date,
  source text not null default 'SYSTEM' check (source in ('SYSTEM', 'LEGACY_IMPORT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_customer_idx on public.subscriptions (customer_id);
create index subscriptions_actor_idx on public.subscriptions (actor_id);
create index subscriptions_payment_link_idx on public.subscriptions (payment_link_id);
create index subscriptions_asaas_sub_idx on public.subscriptions (asaas_subscription_id);
create index subscriptions_asaas_installment_idx on public.subscriptions (asaas_installment_id);

-- Every real Asaas payment transaction. This — not the link's face value —
-- is the source of truth for realized revenue.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions(id),
  payment_link_id uuid references public.payment_links(id),
  customer_id uuid references public.customers(id),
  asaas_payment_id text not null unique,
  status text not null,
  value numeric(12,2) not null,
  net_value numeric(12,2),
  billing_type text,
  due_date date,
  payment_date date,
  confirmed_date date,
  installment_number integer,
  installment_count integer,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_subscription_idx on public.payments (subscription_id);
create index payments_payment_link_idx on public.payments (payment_link_id);
create index payments_customer_idx on public.payments (customer_id);
create index payments_status_idx on public.payments (status);

-- Raw webhook log, keyed by Asaas's own event id, so re-delivered events
-- (Asaas retries on non-2xx) never get double-processed.
create table public.asaas_webhook_events (
  id uuid primary key default gen_random_uuid(),
  asaas_event_id text unique,
  event_type text not null,
  payment_id text,
  payload jsonb not null,
  processed_at timestamptz,
  received_at timestamptz not null default now()
);

create index asaas_webhook_events_payment_idx on public.asaas_webhook_events (payment_id);

create trigger customers_set_updated_at before update on public.customers
for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions
for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
for each row execute function public.set_updated_at();

alter table public.customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.asaas_webhook_events enable row level security;

create policy "authenticated_read_customers" on public.customers for select to authenticated using (true);
create policy "authenticated_read_subscriptions" on public.subscriptions for select to authenticated using (true);
create policy "authenticated_read_payments" on public.payments for select to authenticated using (true);
create policy "authenticated_read_asaas_webhook_events" on public.asaas_webhook_events for select to authenticated using (true);

comment on table public.customers is 'Roster real de clientes (escritórios), povoado pelo webhook do Asaas e pela importação histórica das planilhas.';
comment on table public.subscriptions is 'Assinatura/venda de um cliente para um plano, ligada ao link e ao ator comercial que a originou.';
comment on table public.payments is 'Transações de pagamento reais do Asaas (fonte de verdade para receita realizada), idempotentes por asaas_payment_id.';
comment on table public.asaas_webhook_events is 'Log bruto de eventos recebidos do webhook do Asaas, usado para idempotência e auditoria.';
