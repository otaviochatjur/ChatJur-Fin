-- Splits the commercial network into 4 explicit categories (Parceiros,
-- Embaixadores, Comercial interno, Comercial externo) and adds monthly
-- commission payouts ("repasses") for Parceiros/Embaixadores/Comercial
-- externo.
--
-- Commission rates are per actor AND per plan (the same partner can sell
-- two plans at two different %s), with an optional "default" rate (no
-- plan_id/custom_plan_id set) used as a fallback when no plan-specific
-- override exists. Payout amounts are computed from payments ACTUALLY
-- RECEIVED in the reference month (not nominal/subscribed MRR) — this
-- mirrors the rest of the app's "real revenue, not face value" rule.
--
-- Comercial interno (Laila, Amanda, Otávio) are salaried employees, not
-- commissioned externals: they get the same role-based features (pricing,
-- links, clients) as everyone else, but are intentionally excluded from
-- actor_commission_rates / actor_payouts and the Repasses tab.
--
-- Every statement below is written to be safely re-runnable (if not
-- exists / drop-then-create) — an earlier partial run of this same file
-- left some objects already in place.

alter table public.commercial_actors drop constraint if exists commercial_actors_role_check;
alter table public.commercial_actors add constraint commercial_actors_role_check
  check (role in ('PARTNER', 'AMBASSADOR', 'EXTERNAL_SALES', 'INTERNAL_SALES'));

insert into public.commercial_actors (name, role, status)
select v.name, v.role, 'ACTIVE'
from (values
  ('Laila', 'INTERNAL_SALES'),
  ('Amanda', 'INTERNAL_SALES'),
  ('Otávio', 'INTERNAL_SALES')
) as v(name, role)
where not exists (
  select 1 from public.commercial_actors existing
  where existing.role = v.role and existing.name = v.name
);

-- Individual repasse % per actor. A row with plan_id and custom_plan_id
-- both null is that actor's "default" rate, used when no override exists
-- for the specific plan a customer bought.
create table if not exists public.actor_commission_rates (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.commercial_actors(id),
  plan_id uuid references public.plans(id),
  custom_plan_id uuid references public.actor_custom_plans(id),
  rate_percent numeric(5,2) not null check (rate_percent >= 0 and rate_percent <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint actor_commission_rates_single_plan_ref check (not (plan_id is not null and custom_plan_id is not null))
);

create unique index if not exists actor_commission_rates_default_idx on public.actor_commission_rates (actor_id) where (plan_id is null and custom_plan_id is null);
create unique index if not exists actor_commission_rates_plan_idx on public.actor_commission_rates (actor_id, plan_id) where plan_id is not null;
create unique index if not exists actor_commission_rates_custom_plan_idx on public.actor_commission_rates (actor_id, custom_plan_id) where custom_plan_id is not null;
create index if not exists actor_commission_rates_actor_idx on public.actor_commission_rates (actor_id);

drop trigger if exists actor_commission_rates_set_updated_at on public.actor_commission_rates;
create trigger actor_commission_rates_set_updated_at before update on public.actor_commission_rates
for each row execute function public.set_updated_at();

alter table public.actor_commission_rates enable row level security;
drop policy if exists "authenticated_read_actor_commission_rates" on public.actor_commission_rates;
create policy "authenticated_read_actor_commission_rates" on public.actor_commission_rates for select to authenticated using (true);

comment on table public.actor_commission_rates is
  'Individual repasse % per actor, optionally overridden per plan/custom_plan. A row with both plan_id and custom_plan_id null is the actor''s default/fallback rate.';

-- History of repasses actually paid. Only rows for periods that were
-- explicitly marked as paid exist here — pending amounts for a period are
-- always computed live from payments x actor_commission_rates, never
-- pre-generated, so they can't go stale if a payment is later refunded.
create table if not exists public.actor_payouts (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.commercial_actors(id),
  -- Always the 1st day of the reference month (e.g. 2026-09-01);
  -- unique(actor_id, reference_month) enforces one payout record per actor
  -- per month.
  reference_month date not null,
  amount numeric(12,2) not null check (amount >= 0),
  computed_amount numeric(12,2) not null default 0,
  notes text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_id, reference_month)
);

create index if not exists actor_payouts_actor_idx on public.actor_payouts (actor_id);
create index if not exists actor_payouts_month_idx on public.actor_payouts (reference_month desc);

drop trigger if exists actor_payouts_set_updated_at on public.actor_payouts;
create trigger actor_payouts_set_updated_at before update on public.actor_payouts
for each row execute function public.set_updated_at();

alter table public.actor_payouts enable row level security;
drop policy if exists "authenticated_read_actor_payouts" on public.actor_payouts;
create policy "authenticated_read_actor_payouts" on public.actor_payouts for select to authenticated using (true);

comment on table public.actor_payouts is
  'History of repasses actually paid to Parceiros/Embaixadores/Comercial externo. computed_amount snapshots what the system calculated (received payments x commission rate) at the moment it was marked paid; amount is what was actually transferred (editable for manual adjustments).';

-- Data fix: subscriptions created from an ANNUAL plan paid in more than 1
-- installment were storing the *per-installment* payment value as
-- subscriptions.value (Asaas splits an INSTALLMENT-charge total into N
-- equal payments, and the app used to grab whichever payment created the
-- row) instead of the full annual contract value. This throws off every
-- MRR figure derived from that subscription (Parceiros/Embaixadores
-- tables, Revenue, Repasses...). New subscriptions are fixed going
-- forward (see lib/payment-sync.ts); this backfills existing rows from
-- their originating payment_links.value, which always holds the full
-- amount regardless of how the customer split it.
update public.subscriptions s
set value = pl.value
from public.payment_links pl
where s.payment_link_id = pl.id
  and s.billing_period = 'ANNUAL'
  and s.value <> pl.value;
