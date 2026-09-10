begin;

alter table public.payments
  add column if not exists refunded_at date;

alter table public.implementation_payments
  add column if not exists refunded_at date;

-- O Asaas mantém a data de cada estorno no array `refunds`. Promovemos a
-- conclusão mais recente para uma coluna própria, preservando o JSON bruto.
with refund_dates as (
  select p.id, max(left(item->>'dateCreated', 10)::date) as refunded_at
  from public.payments p
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.raw_payload->'refunds') = 'array'
      then p.raw_payload->'refunds' else '[]'::jsonb end
  ) item
  where item->>'status' = 'DONE'
    and item->>'dateCreated' ~ '^\d{4}-\d{2}-\d{2}'
  group by p.id
)
update public.payments p
set refunded_at = refunds.refunded_at
from refund_dates refunds
where p.refunded_at is null
  and p.id = refunds.id
  and refunds.refunded_at is not null;

with refund_dates as (
  select p.id, max(left(item->>'dateCreated', 10)::date) as refunded_at
  from public.implementation_payments p
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.raw_payload->'refunds') = 'array'
      then p.raw_payload->'refunds' else '[]'::jsonb end
  ) item
  where item->>'status' = 'DONE'
    and item->>'dateCreated' ~ '^\d{4}-\d{2}-\d{2}'
  group by p.id
)
update public.implementation_payments p
set refunded_at = refunds.refunded_at
from refund_dates refunds
where p.refunded_at is null
  and p.id = refunds.id
  and refunds.refunded_at is not null;

comment on column public.payments.refunded_at is
  'Data em que o estorno mais recente foi concluído no Asaas.';
comment on column public.implementation_payments.refunded_at is
  'Data em que o estorno mais recente foi concluído no Asaas.';

notify pgrst, 'reload schema';
commit;
