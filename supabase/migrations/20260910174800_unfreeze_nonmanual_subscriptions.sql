-- FROZEN is a business decision made by the operator. Remove the legacy
-- automatic value; keep ACTIVE where a separate paid transaction proves it.
update public.subscriptions s
set status = case
  when exists (
    select 1
    from public.payments p
    where p.tenant_id = s.tenant_id
      and p.subscription_id = s.id
      and p.status in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
  ) then 'ACTIVE'
  else null
end
where s.status = 'FROZEN'
  and not s.status_manually_set;

notify pgrst, 'reload schema';
