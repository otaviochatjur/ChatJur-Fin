-- Preserve historical Asaas payments for customers already recognized by
-- their primary or alias customer ID, even when no payment link can be
-- resolved. These rows remain deliberately unassigned to a subscription and
-- plan so the UI can flag them for regularization without guessing.
with latest_base as (
  select distinct on (base.tenant_id, base.external_id)
    base.tenant_id,
    base.external_id,
    base.payload,
    base.observed_at
  from public.asaas_base_payments base
  order by base.tenant_id, base.external_id, base.observed_at desc
), missing as (
  select base.*
  from latest_base base
  left join public.payments pay
    on pay.tenant_id = base.tenant_id
   and pay.asaas_payment_id = base.external_id
  left join public.implementation_payments implementation
    on implementation.tenant_id = base.tenant_id
   and implementation.asaas_payment_id = base.external_id
  where pay.id is null
    and implementation.id is null
), resolved as (
  select
    missing.*,
    coalesce(customer.id, alias.customer_id) as customer_id
  from missing
  left join public.customers customer
    on customer.tenant_id = missing.tenant_id
   and customer.asaas_customer_id = missing.payload->>'customer'
  left join public.customer_asaas_aliases alias
    on alias.tenant_id = missing.tenant_id
   and alias.asaas_customer_id = missing.payload->>'customer'
), prepared as (
  select
    resolved.*,
    refund.refunded_at
  from resolved
  left join lateral (
    select max(left(item->>'dateCreated', 10)::date) as refunded_at
    from jsonb_array_elements(
      case when jsonb_typeof(resolved.payload->'refunds') = 'array'
        then resolved.payload->'refunds' else '[]'::jsonb end
    ) item
    where item->>'status' = 'DONE'
      and item->>'dateCreated' ~ '^\d{4}-\d{2}-\d{2}'
  ) refund on true
  where resolved.customer_id is not null
)
insert into public.payments (
  tenant_id, subscription_id, payment_link_id, asaas_payment_link_id,
  customer_id, asaas_payment_id, status, value, net_value, billing_type,
  due_date, payment_date, confirmed_date, installment_number,
  installment_count, refunded_at, raw_payload, created_at
)
select
  prepared.tenant_id,
  null,
  null,
  nullif(prepared.payload->>'paymentLink', ''),
  prepared.customer_id,
  prepared.external_id,
  coalesce(nullif(prepared.payload->>'status', ''), 'UNKNOWN'),
  coalesce(nullif(prepared.payload->>'value', '')::numeric, 0),
  nullif(prepared.payload->>'netValue', '')::numeric,
  nullif(prepared.payload->>'billingType', ''),
  case when prepared.payload->>'dueDate' ~ '^\d{4}-\d{2}-\d{2}'
    then left(prepared.payload->>'dueDate', 10)::date end,
  case when coalesce(prepared.payload->>'paymentDate', prepared.payload->>'clientPaymentDate') ~ '^\d{4}-\d{2}-\d{2}'
    then left(coalesce(prepared.payload->>'paymentDate', prepared.payload->>'clientPaymentDate'), 10)::date end,
  case when prepared.payload->>'confirmedDate' ~ '^\d{4}-\d{2}-\d{2}'
    then left(prepared.payload->>'confirmedDate', 10)::date end,
  nullif(prepared.payload->>'installmentNumber', '')::integer,
  null,
  prepared.refunded_at,
  prepared.payload,
  case when prepared.payload->>'dateCreated' ~ '^\d{4}-\d{2}-\d{2}'
    then (prepared.payload->>'dateCreated')::timestamptz else prepared.observed_at end
from prepared
on conflict (tenant_id, asaas_payment_id) do nothing;

notify pgrst, 'reload schema';
