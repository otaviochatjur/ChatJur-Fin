-- Support for links that exist in the real Asaas account but weren't
-- created through this app's "Gerar link" flow (e.g. created by hand
-- directly in the Asaas dashboard). These land here without a known
-- partner/ambassador/sales rep *or* a known plan, so both FKs must be
-- nullable; the UI then shows them as "Pendente" until someone assigns
-- both.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_links' and column_name = 'actor_id' and is_nullable = 'NO'
  ) then
    alter table public.payment_links alter column actor_id drop not null;
  end if;
end $$;

-- Upsert target for the Asaas sync job: one row per real Asaas payment
-- link, so re-running the sync never creates duplicates.
create unique index if not exists payment_links_asaas_id_uq
  on public.payment_links (asaas_payment_link_id)
  where asaas_payment_link_id is not null;
