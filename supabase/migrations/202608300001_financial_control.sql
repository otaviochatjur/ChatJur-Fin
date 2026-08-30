create extension if not exists pgcrypto;

create table public.commercial_actors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('PARTNER', 'AMBASSADOR', 'EXTERNAL_SALES')),
  slug text,
  coupon text,
  reference_code text,
  email text,
  phone text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, name)
);

create index commercial_actors_role_idx on public.commercial_actors (role);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  billing_period text not null check (billing_period in ('MONTHLY', 'ANNUAL')),
  standard_value numeric(12,2) not null check (standard_value > 0),
  annual_installment_limit integer check (annual_installment_limit between 1 and 6),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.actor_price_versions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.commercial_actors(id),
  plan_id uuid not null references public.plans(id),
  value numeric(12,2) not null check (value > 0),
  effective_from date not null,
  effective_until date,
  apply_to_renewals boolean not null default false,
  change_reason text,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from)
);

create unique index actor_price_versions_current_uq
  on public.actor_price_versions (actor_id, plan_id)
  where effective_until is null;
create index actor_price_versions_actor_plan_idx on public.actor_price_versions (actor_id, plan_id, effective_from desc);

create table public.payment_links (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.commercial_actors(id),
  plan_id uuid references public.plans(id),
  price_version_id uuid references public.actor_price_versions(id),
  asaas_payment_link_id text,
  external_reference text not null unique,
  url text,
  display_name text not null,
  value numeric(12,2) not null check (value > 0),
  billing_period text not null check (billing_period in ('MONTHLY', 'ANNUAL')),
  max_installments integer check (max_installments between 1 and 10),
  legacy boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'PENDING')),
  source text not null default 'SYSTEM',
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

create index payment_links_actor_idx on public.payment_links (actor_id);
create index payment_links_status_idx on public.payment_links (status);

create table public.customer_attributions (
  id uuid primary key default gen_random_uuid(),
  customer_external_id text not null unique,
  partner_actor_id uuid references public.commercial_actors(id),
  external_sales_actor_id uuid references public.commercial_actors(id),
  payment_link_id uuid references public.payment_links(id),
  attributed_at timestamptz not null default now(),
  notes text,
  check (partner_actor_id is not null or external_sales_actor_id is not null)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  actor_email text,
  created_at timestamptz not null default now()
);

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger commercial_actors_set_updated_at before update on public.commercial_actors
for each row execute function public.set_updated_at();
create trigger plans_set_updated_at before update on public.plans
for each row execute function public.set_updated_at();

create or replace function public.create_actor_price_version(
  p_actor_id uuid,
  p_plan_id uuid,
  p_value numeric,
  p_effective_from date,
  p_apply_to_renewals boolean default false,
  p_change_reason text default null,
  p_actor_email text default null
) returns public.actor_price_versions
language plpgsql security definer set search_path = public as $$
declare
  previous_row public.actor_price_versions;
  created_row public.actor_price_versions;
begin
  select * into previous_row from public.actor_price_versions
   where actor_id = p_actor_id and plan_id = p_plan_id and effective_until is null
   for update;

  if previous_row.id is not null then
    update public.actor_price_versions
       set effective_until = p_effective_from - 1
     where id = previous_row.id;
  end if;

  insert into public.actor_price_versions(actor_id, plan_id, value, effective_from, apply_to_renewals, change_reason)
  values (p_actor_id, p_plan_id, p_value, p_effective_from, coalesce(p_apply_to_renewals, false), p_change_reason)
  returning * into created_row;

  insert into public.audit_events(entity_type, entity_id, action, before_json, after_json, actor_email)
  values ('actor_price_version', created_row.id::text, 'CREATED', to_jsonb(previous_row), to_jsonb(created_row), p_actor_email);
  return created_row;
end;
$$;

revoke all on function public.create_actor_price_version(uuid, uuid, numeric, date, boolean, text, text) from public, anon, authenticated;
grant execute on function public.create_actor_price_version(uuid, uuid, numeric, date, boolean, text, text) to service_role;

alter table public.commercial_actors enable row level security;
alter table public.plans enable row level security;
alter table public.actor_price_versions enable row level security;
alter table public.payment_links enable row level security;
alter table public.customer_attributions enable row level security;
alter table public.audit_events enable row level security;

create policy "authenticated_read_commercial_actors" on public.commercial_actors for select to authenticated using (true);
create policy "authenticated_read_plans" on public.plans for select to authenticated using (true);
create policy "authenticated_read_actor_prices" on public.actor_price_versions for select to authenticated using (true);
create policy "authenticated_read_payment_links" on public.payment_links for select to authenticated using (true);
create policy "authenticated_read_customer_attributions" on public.customer_attributions for select to authenticated using (true);
create policy "authenticated_read_audit_events" on public.audit_events for select to authenticated using (true);

comment on table public.commercial_actors is 'Parceiros, embaixadores e comerciais externos, preservados como papéis distintos.';
comment on table public.actor_price_versions is 'Histórico imutável dos preços comerciais por plano e pessoa/organização.';
comment on table public.payment_links is 'Links do Asaas, incluindo links históricos marcados como legacy.';
