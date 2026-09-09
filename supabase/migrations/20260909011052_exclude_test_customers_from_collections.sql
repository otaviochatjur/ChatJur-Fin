create table public.asaas_customer_exclusions (
  tenant_id uuid not null references public.nexo_tenants(id) on delete cascade,
  asaas_customer_id text not null,
  email text,
  reason text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, asaas_customer_id)
);

alter table public.asaas_customer_exclusions enable row level security;
revoke all on public.asaas_customer_exclusions from anon;
grant select, insert, update, delete on public.asaas_customer_exclusions to authenticated;
grant all on public.asaas_customer_exclusions to service_role;

create policy own_asaas_customer_exclusions
  on public.asaas_customer_exclusions
  for all to authenticated
  using (tenant_id in (
    select id from public.nexo_tenants
    where owner_user_id = (select auth.uid())
  ))
  with check (tenant_id in (
    select id from public.nexo_tenants
    where owner_user_id = (select auth.uid())
  ));

comment on table public.asaas_customer_exclusions is
  'IDs do Asaas deliberadamente ignorados na criação de clientes e nos relatórios de cobrança.';

notify pgrst, 'reload schema';
