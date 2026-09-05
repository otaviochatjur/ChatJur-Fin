-- "Implantação" (taxa única de implantação — API Oficial da Meta,
-- integração com Claude/IA, etc.) é um produto diferente de um plano
-- recorrente: nunca gera assinatura/MRR, é uma cobrança avulsa. Isso
-- permite catalogar esses produtos no mesmo painel "Planos e Links" e dá a
-- cada pagamento contra um deles seu próprio registro, separado de
-- `payments`/`subscriptions`.
--
-- Idempotente: pode ser re-executada sem erro.

do $$
begin
  alter table public.plans drop constraint if exists plans_billing_period_check;
  alter table public.plans add constraint plans_billing_period_check check (billing_period in ('MONTHLY', 'ANNUAL', 'ONE_TIME'));
exception when duplicate_object then null;
end $$;

alter table public.plans add column if not exists kind text not null default 'RECURRING';
do $$
begin
  alter table public.plans add constraint plans_kind_check check (kind in ('RECURRING', 'IMPLEMENTATION'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.payment_links drop constraint if exists payment_links_billing_period_check;
  alter table public.payment_links add constraint payment_links_billing_period_check check (billing_period in ('MONTHLY', 'ANNUAL', 'ONE_TIME'));
exception when duplicate_object then null;
end $$;

create table if not exists public.implementation_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  actor_id uuid references public.commercial_actors(id),
  payment_link_id uuid references public.payment_links(id),
  plan_id uuid references public.plans(id),
  asaas_payment_id text not null unique,
  description text not null,
  status text not null,
  value numeric(12,2) not null,
  net_value numeric(12,2),
  billing_type text,
  due_date date,
  payment_date date,
  confirmed_date date,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists implementation_payments_customer_idx on public.implementation_payments (customer_id);
create index if not exists implementation_payments_actor_idx on public.implementation_payments (actor_id);
create index if not exists implementation_payments_status_idx on public.implementation_payments (status);
create index if not exists implementation_payments_link_idx on public.implementation_payments (payment_link_id);

drop trigger if exists implementation_payments_set_updated_at on public.implementation_payments;
create trigger implementation_payments_set_updated_at before update on public.implementation_payments
for each row execute function public.set_updated_at();

alter table public.implementation_payments enable row level security;
drop policy if exists "authenticated_read_implementation_payments" on public.implementation_payments;
create policy "authenticated_read_implementation_payments" on public.implementation_payments for select to authenticated using (true);

comment on table public.implementation_payments is 'Pagamentos de implantação (taxa única — ex.: API Oficial Meta, integração Claude/IA). Separados de payments/subscriptions pois nunca geram MRR.';
comment on column public.plans.kind is 'RECURRING = plano de assinatura, entra no MRR; IMPLEMENTATION = taxa única de implantação, nunca gera assinatura — pagamentos vão para implementation_payments.';
