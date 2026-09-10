begin;

alter table public.payments
  add column if not exists asaas_payment_link_id text;

alter table public.implementation_payments
  add column if not exists asaas_payment_link_id text;

-- Older environments can predate the manual one-time payment migration.
alter table public.implementation_payments
  alter column asaas_payment_id drop not null;

alter table public.implementation_payments
  add column if not exists source text not null default 'SYSTEM';

do $$
begin
  alter table public.implementation_payments
    drop constraint if exists implementation_payments_source_check;
  alter table public.implementation_payments
    add constraint implementation_payments_source_check
    check (source in ('SYSTEM', 'MANUAL'));
exception when duplicate_object then null;
end $$;

update public.payments
set asaas_payment_link_id = nullif(raw_payload->>'paymentLink', '')
where asaas_payment_link_id is null
  and nullif(raw_payload->>'paymentLink', '') is not null;

update public.implementation_payments
set asaas_payment_link_id = nullif(raw_payload->>'paymentLink', '')
where asaas_payment_link_id is null
  and nullif(raw_payload->>'paymentLink', '') is not null;

-- A successful payment proves the subscription is active. Pending, overdue
-- and refunded payments never imply FROZEN; that is an operator decision.
update public.subscriptions s
set status = 'ACTIVE'
where s.status is null
  and not s.status_manually_set
  and exists (
    select 1
    from public.payments p
    where p.tenant_id = s.tenant_id
      and p.subscription_id = s.id
      and p.status in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
  );

comment on column public.payments.asaas_payment_link_id is
  'ID do link presente no pagamento original do Asaas; NULL identifica cobrança criada sem link.';
comment on column public.implementation_payments.asaas_payment_link_id is
  'ID do link presente no pagamento original do Asaas; NULL identifica cobrança criada sem link.';

notify pgrst, 'reload schema';
commit;
