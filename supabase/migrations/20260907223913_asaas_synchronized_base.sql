create table public.asaas_base_sync (
 tenant_id uuid primary key references public.nexo_tenants(id),
 generation uuid not null default gen_random_uuid(), active_generation uuid,
 status text not null default 'RUNNING' check(status in ('RUNNING','READY')),
 phase integer not null default 0, page_offset integer not null default 0, processed integer not null default 0,
 started_at timestamptz not null default now(), completed_at timestamptz, last_event_at timestamptz, error text
);
create table public.asaas_base_objects (
 tenant_id uuid not null references public.nexo_tenants(id), generation uuid not null,
 kind text not null check(kind in ('CUSTOMER','PAYMENT','LINK')), external_id text not null,
 payload jsonb not null, observed_at timestamptz not null,
 primary key(tenant_id,generation,kind,external_id)
);
alter table public.asaas_base_sync enable row level security;
alter table public.asaas_base_objects enable row level security;
revoke all on public.asaas_base_sync,public.asaas_base_objects from anon;
grant select,insert,update,delete on public.asaas_base_sync,public.asaas_base_objects to authenticated;
grant all on public.asaas_base_sync,public.asaas_base_objects to service_role;
create policy own_asaas_base_sync on public.asaas_base_sync to authenticated
 using(tenant_id in(select id from public.nexo_tenants where owner_user_id=(select auth.uid())))
 with check(tenant_id in(select id from public.nexo_tenants where owner_user_id=(select auth.uid())));
create policy own_asaas_base_objects on public.asaas_base_objects to authenticated
 using(tenant_id in(select id from public.nexo_tenants where owner_user_id=(select auth.uid())))
 with check(tenant_id in(select id from public.nexo_tenants where owner_user_id=(select auth.uid())));
create function public.keep_newest_asaas_base_object() returns trigger language plpgsql set search_path='' as $$
begin
 if new.observed_at < old.observed_at then return null; end if;
 return new;
end $$;
create trigger keep_newest_asaas_base_object before update on public.asaas_base_objects for each row execute function public.keep_newest_asaas_base_object();
create view public.asaas_base_payments with(security_invoker=true) as
 select p.tenant_id,p.generation,p.external_id,p.payload,c.payload as customer_payload,p.observed_at
 from public.asaas_base_objects p left join public.asaas_base_objects c
 on c.tenant_id=p.tenant_id and c.generation=p.generation and c.kind='CUSTOMER' and c.external_id=p.payload->>'customer'
 where p.kind='PAYMENT' and coalesce(p.payload->>'deleted','false') <> 'true';
revoke all on public.asaas_base_payments from anon;
grant select on public.asaas_base_payments to authenticated,service_role;
alter table public.collection_reports add column source_generation uuid, add column source_updated_at timestamptz;
alter table public.payment_links add column asaas_snapshot jsonb, add column asaas_synced_at timestamptz;
create function public.finish_asaas_base_sync(p_tenant uuid,p_generation uuid,p_offset integer) returns jsonb
 language plpgsql set search_path='' as $$
declare v public.asaas_base_sync;
begin
 select * into v from public.asaas_base_sync where tenant_id=p_tenant for update;
 if v.tenant_id is null then raise exception 'Base não encontrada'; end if;
 if v.generation<>p_generation or v.status<>'RUNNING' or v.phase<>2 or v.page_offset<>p_offset then return to_jsonb(v); end if;
 update public.payment_links l set asaas_snapshot=o.payload,asaas_synced_at=o.observed_at,url=coalesce(o.payload->>'url',l.url)
 from public.asaas_base_objects o where o.tenant_id=p_tenant and o.generation=p_generation and o.kind='LINK'
 and l.tenant_id=p_tenant and l.asaas_payment_link_id=o.external_id
 and (l.asaas_synced_at is null or l.asaas_synced_at<=o.observed_at);
 insert into public.payment_links(tenant_id,asaas_payment_link_id,external_reference,url,display_name,value,billing_period,max_installments,status,source,asaas_snapshot,asaas_synced_at)
 select p_tenant,o.external_id,'ASAAS_'||o.external_id,o.payload->>'url',coalesce(o.payload->>'name','Link sem nome'),(o.payload->>'value')::numeric,
 case when o.payload->>'chargeType'='INSTALLMENT' or o.payload->>'subscriptionCycle'='YEARLY' then 'ANNUAL' else 'MONTHLY' end,
 case when o.payload->>'chargeType'='INSTALLMENT' then (o.payload->>'maxInstallmentCount')::integer else null end,'PENDING','ASAAS_SYNC',o.payload,o.observed_at
 from public.asaas_base_objects o where o.tenant_id=p_tenant and o.generation=p_generation and o.kind='LINK'
 and coalesce(o.payload->>'deleted','false')<>'true' and jsonb_typeof(o.payload->'value')='number' and (o.payload->>'value')::numeric>0
 on conflict do nothing;
 update public.asaas_base_sync set active_generation=p_generation,status='READY',phase=3,completed_at=now(),error=null where tenant_id=p_tenant;
 delete from public.asaas_base_objects o where o.tenant_id=p_tenant and o.generation<>p_generation
 and o.generation<>coalesce(v.active_generation,p_generation)
 and not exists(select 1 from public.collection_reports r where r.tenant_id=p_tenant and r.status='RUNNING' and r.source_generation=o.generation);
 return (select to_jsonb(s) from public.asaas_base_sync s where s.tenant_id=p_tenant);
end $$;
revoke all on function public.finish_asaas_base_sync(uuid,uuid,integer) from public,anon;
grant execute on function public.finish_asaas_base_sync(uuid,uuid,integer) to authenticated,service_role;
notify pgrst,'reload schema';
