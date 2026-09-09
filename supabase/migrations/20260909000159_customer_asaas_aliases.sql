begin;

-- Um mesmo cliente real pode preencher mais de um link do Asaas e receber
-- vários cus_*. O cadastro interno continua único; esta tabela guarda todas
-- as identidades externas que devem herdar o mesmo status e relacionamento.
create unique index if not exists customers_tenant_id_id_uq
  on public.customers (tenant_id, id);

create table public.customer_asaas_aliases (
  tenant_id uuid not null references public.nexo_tenants(id),
  asaas_customer_id text not null,
  customer_id uuid not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (tenant_id, asaas_customer_id),
  foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete cascade
);

create index customer_asaas_aliases_customer_idx
  on public.customer_asaas_aliases (tenant_id, customer_id);

-- Todo identificador principal já conhecido também passa pela nova resolução.
insert into public.customer_asaas_aliases
  (tenant_id, asaas_customer_id, customer_id, is_primary)
select tenant_id, asaas_customer_id, id, true
from public.customers
where asaas_customer_id is not null
on conflict (tenant_id, asaas_customer_id) do nothing;

-- Recupera aliases históricos usando pagamentos que já foram conciliados com
-- segurança a um cliente interno. IDs que apontaram para mais de um cliente
-- são deliberadamente ignorados para não consolidar pessoas distintas.
with candidates as (
  select o.tenant_id,
         o.payload->>'customer' as asaas_customer_id,
         p.customer_id
  from public.asaas_base_objects o
  join public.payments p
    on p.tenant_id = o.tenant_id
   and p.asaas_payment_id = o.external_id
  where o.kind = 'PAYMENT'
    and nullif(o.payload->>'customer', '') is not null
), unambiguous as (
  select tenant_id,
         asaas_customer_id,
         min(customer_id::text)::uuid as customer_id
  from candidates
  group by tenant_id, asaas_customer_id
  having count(distinct customer_id) = 1
)
insert into public.customer_asaas_aliases
  (tenant_id, asaas_customer_id, customer_id, is_primary)
select tenant_id, asaas_customer_id, customer_id, false
from unambiguous
on conflict (tenant_id, asaas_customer_id) do nothing;

alter table public.customer_asaas_aliases enable row level security;
revoke all on public.customer_asaas_aliases from anon;
grant select, insert, update, delete on public.customer_asaas_aliases to authenticated;
grant all on public.customer_asaas_aliases to service_role;

create policy own_customer_asaas_aliases
  on public.customer_asaas_aliases
  for all to authenticated
  using (tenant_id in (
    select id from public.nexo_tenants
    where owner_user_id = (select auth.uid())
  ))
  with check (tenant_id in (
    select id from public.nexo_tenants
    where owner_user_id = (select auth.uid())
  ));

comment on table public.customer_asaas_aliases is
  'Relaciona múltiplos IDs de cliente do Asaas ao mesmo cliente interno.';

notify pgrst, 'reload schema';
commit;
