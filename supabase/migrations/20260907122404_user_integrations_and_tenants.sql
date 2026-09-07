begin;
create table public.nexo_tenants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid unique references auth.users(id),
  reserved_email text unique,
  legacy boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.nexo_tenants enable row level security;
revoke all on public.nexo_tenants from anon, authenticated;
grant select on public.nexo_tenants to authenticated;
create policy own_tenant on public.nexo_tenants for select to authenticated using (owner_user_id = (select auth.uid()));
insert into public.nexo_tenants (reserved_email, legacy, owner_user_id)
values ('otavio@chatjuridico.com.br', true, (select id from auth.users where lower(email)='otavio@chatjuridico.com.br' and email_confirmed_at is not null limit 1));

create table public.nexo_integrations (
  tenant_id uuid not null references public.nexo_tenants(id),
  provider text not null check (provider in ('asaas','chat-juridico')),
  encrypted_key text not null,
  environment text not null default 'production' check(environment in ('production','sandbox')),
  account_id text,
  webhook_hash text unique,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,provider)
);
alter table public.nexo_integrations enable row level security;
revoke all on public.nexo_integrations from anon, authenticated;

-- Each existing row remains in the reserved owner's base. No records are deleted.
do $$
declare t text; old_policy record; uq record; fields text; legacy_id uuid;
begin
 select id into legacy_id from public.nexo_tenants where legacy;
 foreach t in array array['commercial_actors','plans','actor_price_versions','payment_links','customer_attributions','audit_events','actor_custom_plans','customers','subscriptions','payments','asaas_webhook_events','actor_commission_rates','actor_payouts','connect_leads','implementation_payments'] loop
  execute format('alter table public.%I add column tenant_id uuid references public.nexo_tenants(id)', t);
  execute format('update public.%I set tenant_id = $1', t) using legacy_id;
  execute format('alter table public.%I alter column tenant_id set not null', t);
  execute format('create index %I on public.%I (tenant_id)', t || '_tenant_idx',t);
  for old_policy in select policyname from pg_policies where schemaname='public' and tablename=t loop
    execute format('drop policy %I on public.%I',old_policy.policyname,t);
  end loop;
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy tenant_access on public.%I for all to authenticated using (tenant_id in (select id from public.nexo_tenants where owner_user_id=(select auth.uid()))) with check (tenant_id in (select id from public.nexo_tenants where owner_user_id=(select auth.uid())))',t);
  -- Natural keys are unique within a base, not across independent accounts.
  for uq in select c.conname,c.conkey from pg_constraint c where c.conrelid=format('public.%I',t)::regclass and c.contype='u' loop
    select string_agg(quote_ident(a.attname),',' order by k.ord) into fields from unnest(uq.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=format('public.%I',t)::regclass and a.attnum=k.num;
    execute format('alter table public.%I drop constraint %I',t,uq.conname);
    execute format('alter table public.%I add constraint %I unique (tenant_id,%s)',t,uq.conname,fields);
  end loop;
 end loop;
end $$;
drop index if exists public.payment_links_asaas_id_uq;
create unique index payment_links_asaas_id_uq on public.payment_links(tenant_id,asaas_payment_link_id) where asaas_payment_link_id is not null;

-- Reject references to records in another base, including privileged webhook writes.
create schema if not exists nexo_private;
revoke all on schema nexo_private from public, anon, authenticated;
create function nexo_private.check_tenant_links() returns trigger language plpgsql security definer set search_path='' as $$
declare fk record; parent_tenant uuid; reference_id text;
begin
 if TG_OP='UPDATE' and new.tenant_id is distinct from old.tenant_id then raise exception 'A base de um registro não pode ser alterada.'; end if;
 for fk in
  select c.confrelid::regclass as parent_table,a.attname as child_column,b.attname as parent_column
  from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[1]
  where c.conrelid=TG_RELID and c.contype='f' and array_length(c.conkey,1)=1
  and c.confrelid <> 'public.nexo_tenants'::regclass
  and exists(select 1 from pg_attribute z where z.attrelid=c.confrelid and z.attname='tenant_id')
 loop
  reference_id=to_jsonb(new)->>fk.child_column;
  if reference_id is not null then
   execute format('select tenant_id from %s where %I=$1::uuid',fk.parent_table,fk.parent_column) into parent_tenant using reference_id;
   if parent_tenant is distinct from new.tenant_id then raise exception 'Vínculo inválido para esta conta.'; end if;
  end if;
 end loop;
 return new;
end $$;
revoke all on function nexo_private.check_tenant_links() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['commercial_actors','plans','actor_price_versions','payment_links','customer_attributions','audit_events','actor_custom_plans','customers','subscriptions','payments','asaas_webhook_events','actor_commission_rates','actor_payouts','connect_leads','implementation_payments'] loop
  execute format('create trigger check_tenant_links before insert or update on public.%I for each row execute function nexo_private.check_tenant_links()',t);
 end loop;
end $$;
-- Legacy security-definer RPCs are not part of the application API.
do $$ declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname='create_actor_price_version' loop
  execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
grant all on public.nexo_tenants,public.nexo_integrations to service_role;
notify pgrst,'reload schema';
commit;
