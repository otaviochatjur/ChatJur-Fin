insert into public.plans (code, name, billing_period, standard_value, annual_installment_limit)
values
  ('CRM_IA_MONTHLY', 'CRM + IA', 'MONTHLY', 297.00, null),
  ('CRM_IA_ANNUAL', 'CRM + IA', 'ANNUAL', 2490.00, 6),
  ('CRM_IA_PLUS_MONTHLY', 'CRM + IA Plus', 'MONTHLY', 597.00, null),
  ('CRM_IA_PLUS_ANNUAL', 'CRM + IA Plus', 'ANNUAL', 4969.92, 6)
on conflict (code) do update set
  name = excluded.name,
  billing_period = excluded.billing_period,
  standard_value = excluded.standard_value,
  annual_installment_limit = excluded.annual_installment_limit,
  status = 'ACTIVE';
