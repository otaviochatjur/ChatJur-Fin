create index asaas_base_open_payments_idx
  on public.asaas_base_objects (tenant_id, generation, external_id)
  where kind = 'PAYMENT'
    and (payload->>'status') in ('PENDING', 'OVERDUE')
    and coalesce(payload->>'deleted', 'false') <> 'true';
