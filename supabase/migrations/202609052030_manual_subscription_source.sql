-- Allows registering a subscription/plan by hand for customers that don't
-- (yet, or ever) go through an Asaas payment link — e.g. a client that came
-- in from the "⭐ Base de Clientes" sheet intake (Nome/Email/Telefone/
-- OfficeId only) and is billed outside this system, or whose first payment
-- hasn't synced yet. Distinct from 'SYSTEM' (created automatically from a
-- real Asaas payment) and 'LEGACY_IMPORT' (bulk-imported historical rows),
-- so reports can tell which subscriptions have no payment backing them.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'subscriptions_source_check'
  ) then
    alter table public.subscriptions drop constraint subscriptions_source_check;
  end if;
end $$;

alter table public.subscriptions
  add constraint subscriptions_source_check check (source in ('SYSTEM', 'LEGACY_IMPORT', 'MANUAL'));
