create table public.collection_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.nexo_tenants(id),
  mode text not null check (mode in ('DAILY','OPEN','ALL')),
  report_date date not null,
  rule_config jsonb not null default '{}'::jsonb,
  status text not null default 'RUNNING' check (status in ('RUNNING','COMPLETE')),
  phase integer not null default 0,
  page_offset integer not null default 0,
  processed integer not null default 0,
  row_count integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id,id)
);
create table public.collection_report_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.nexo_tenants(id),
  report_id uuid not null,
  asaas_payment_id text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id,report_id) references public.collection_reports(tenant_id,id),
  unique (tenant_id,report_id,asaas_payment_id)
);
create index collection_reports_owner_date_idx on public.collection_reports (tenant_id,created_at desc);
create index collection_report_rows_report_idx on public.collection_report_rows (tenant_id,report_id,id);
alter table public.collection_reports enable row level security;
alter table public.collection_report_rows enable row level security;
revoke all on public.collection_reports,public.collection_report_rows from anon;
grant select,insert,update on public.collection_reports,public.collection_report_rows to authenticated;
grant all on public.collection_reports,public.collection_report_rows to service_role;
create policy own_reports on public.collection_reports to authenticated
  using (tenant_id in (select id from public.nexo_tenants where owner_user_id=(select auth.uid())))
  with check (tenant_id in (select id from public.nexo_tenants where owner_user_id=(select auth.uid())));
create policy own_report_rows on public.collection_report_rows to authenticated
  using (tenant_id in (select id from public.nexo_tenants where owner_user_id=(select auth.uid())))
  with check (tenant_id in (select id from public.nexo_tenants where owner_user_id=(select auth.uid())));
create table public.collection_settings (
  tenant_id uuid primary key references public.nexo_tenants(id),
  config jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.collection_settings enable row level security;
revoke all on public.collection_settings from anon;
grant select,insert,update on public.collection_settings to authenticated;
grant all on public.collection_settings to service_role;
create policy own_collection_settings on public.collection_settings to authenticated
  using (tenant_id in (select id from public.nexo_tenants where owner_user_id=(select auth.uid())))
  with check (tenant_id in (select id from public.nexo_tenants where owner_user_id=(select auth.uid())));
notify pgrst, 'reload schema';
