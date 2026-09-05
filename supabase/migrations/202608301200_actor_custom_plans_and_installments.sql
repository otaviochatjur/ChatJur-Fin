-- Allow richer installment plans (up to 12x) on both the shared catalog and
-- on generated payment links, and let each commercial actor (partner,
-- ambassador or external seller) have their own one-off custom plans that
-- don't pollute the shared "plans" catalog.

-- Relax the 1-6 ceiling on the catalog's annual installment limit to 1-12.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.plans'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%annual_installment_limit%'
  loop
    execute format('alter table public.plans drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.plans
  add constraint plans_annual_installment_limit_check check (annual_installment_limit between 1 and 12);

-- Relax the 1-10 ceiling on payment_links.max_installments to 1-12.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.payment_links'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%max_installments%'
  loop
    execute format('alter table public.payment_links drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.payment_links
  add constraint payment_links_max_installments_check check (max_installments between 1 and 12);

create table public.actor_custom_plans (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.commercial_actors(id),
  name text not null,
  billing_period text not null check (billing_period in ('MONTHLY', 'ANNUAL')),
  value numeric(12,2) not null check (value > 0),
  max_installments integer check (max_installments between 1 and 12),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index actor_custom_plans_actor_idx on public.actor_custom_plans (actor_id);

alter table public.payment_links
  add column custom_plan_id uuid references public.actor_custom_plans(id);

alter table public.actor_custom_plans enable row level security;

create policy "authenticated_read_actor_custom_plans" on public.actor_custom_plans for select to authenticated using (true);

create trigger actor_custom_plans_set_updated_at before update on public.actor_custom_plans
for each row execute function public.set_updated_at();

comment on table public.actor_custom_plans is 'Planos avulsos/personalizados criados manualmente para um parceiro, embaixador ou comercial externo específico (não entram no catálogo compartilhado).';
