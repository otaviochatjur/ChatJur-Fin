create table public.collection_schedule (
 tenant_id uuid primary key references public.nexo_tenants(id),
 config jsonb not null default '{"enabled":false,"time":"09:00","saturday":false,"sunday":false,"holidays":false}',
 updated_at timestamptz not null default now()
);
create table public.collection_schedule_jobs (
 tenant_id uuid not null references public.nexo_tenants(id), run_date date not null,
 status text not null default 'RUNNING' check(status in ('RUNNING','COMPLETE','REVIEW_REQUIRED')),
 payment_ids jsonb, cursor integer not null default 0, sent integer not null default 0, skipped integer not null default 0,
 lease_token uuid, lease_until timestamptz not null default now(), error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(tenant_id,run_date)
);
create table public.tally_sync_state (
 tenant_id uuid primary key references public.nexo_tenants(id), form_id text not null,
 checked_at timestamptz, lease_until timestamptz not null default now(), lease_token uuid, error text
);
alter table public.collection_schedule enable row level security;
alter table public.collection_schedule_jobs enable row level security;
alter table public.tally_sync_state enable row level security;
revoke all on public.collection_schedule,public.collection_schedule_jobs,public.tally_sync_state from anon;
grant select,insert,update,delete on public.collection_schedule,public.collection_schedule_jobs,public.tally_sync_state to authenticated;
grant all on public.collection_schedule,public.collection_schedule_jobs,public.tally_sync_state to service_role;
create policy own_collection_schedule on public.collection_schedule to authenticated
 using(tenant_id in(select id from public.nexo_tenants where owner_user_id=(select auth.uid())))
 with check(tenant_id in(select id from public.nexo_tenants where owner_user_id=(select auth.uid())));
create policy own_collection_schedule_jobs on public.collection_schedule_jobs to authenticated
 using(tenant_id in(select id from public.nexo_tenants where owner_user_id=(select auth.uid())))
 with check(tenant_id in(select id from public.nexo_tenants where owner_user_id=(select auth.uid())));
create policy own_tally_sync_state on public.tally_sync_state to authenticated
 using(tenant_id in(select id from public.nexo_tenants where owner_user_id=(select auth.uid())))
 with check(tenant_id in(select id from public.nexo_tenants where owner_user_id=(select auth.uid())));
