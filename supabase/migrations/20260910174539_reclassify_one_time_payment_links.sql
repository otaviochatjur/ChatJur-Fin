begin;

-- Move recurring-ledger rows atomically when a link is classified later as
-- implementation/consulting. The obsolete subscription is removed only
-- after its payment history is safely present in the one-time ledger.
create or replace function public.reclassify_payment_link_as_one_time(
  p_tenant uuid,
  p_link uuid,
  p_plan uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid;
  v_name text;
  v_kind text;
  v_moved integer := 0;
  v_removed integer := 0;
begin
  select l.actor_id, l.display_name, plan.kind
    into v_actor, v_name, v_kind
  from public.payment_links l
  join public.plans plan
    on plan.tenant_id = l.tenant_id
   and plan.id = l.plan_id
  where l.tenant_id = p_tenant
    and l.id = p_link
    and l.plan_id = p_plan;

  if not found or v_kind not in ('IMPLEMENTATION', 'CONSULTING') then
    raise exception 'Link e plano de implantação/consultoria inválidos.';
  end if;

  insert into public.implementation_payments (
    tenant_id, customer_id, actor_id, payment_link_id, plan_id,
    asaas_payment_id, asaas_payment_link_id, source, description, status,
    value, net_value, billing_type, due_date, payment_date, confirmed_date,
    refunded_at, raw_payload, created_at
  )
  select
    pay.tenant_id, pay.customer_id, v_actor, pay.payment_link_id, p_plan,
    pay.asaas_payment_id, pay.asaas_payment_link_id, 'SYSTEM', v_name,
    pay.status, pay.value, pay.net_value, pay.billing_type, pay.due_date,
    pay.payment_date, pay.confirmed_date, pay.refunded_at, pay.raw_payload,
    pay.created_at
  from public.payments pay
  where pay.tenant_id = p_tenant
    and pay.payment_link_id = p_link
  on conflict (tenant_id, asaas_payment_id) do update set
    customer_id = excluded.customer_id,
    actor_id = excluded.actor_id,
    payment_link_id = excluded.payment_link_id,
    plan_id = excluded.plan_id,
    asaas_payment_link_id = excluded.asaas_payment_link_id,
    description = excluded.description,
    status = excluded.status,
    value = excluded.value,
    net_value = excluded.net_value,
    billing_type = excluded.billing_type,
    due_date = excluded.due_date,
    payment_date = excluded.payment_date,
    confirmed_date = excluded.confirmed_date,
    refunded_at = excluded.refunded_at,
    raw_payload = excluded.raw_payload;

  get diagnostics v_moved = row_count;

  delete from public.payments
  where tenant_id = p_tenant
    and payment_link_id = p_link;

  delete from public.subscriptions s
  where s.tenant_id = p_tenant
    and s.payment_link_id = p_link
    and not exists (
      select 1
      from public.payments pay
      where pay.tenant_id = s.tenant_id
        and pay.subscription_id = s.id
    );

  get diagnostics v_removed = row_count;

  update public.implementation_payments
  set actor_id = v_actor,
      plan_id = p_plan,
      description = v_name
  where tenant_id = p_tenant
    and payment_link_id = p_link;

  return jsonb_build_object(
    'movedPayments', v_moved,
    'removedSubscriptions', v_removed
  );
end;
$$;

revoke all on function public.reclassify_payment_link_as_one_time(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reclassify_payment_link_as_one_time(uuid, uuid, uuid)
  to service_role;

-- Repair links already classified as one-time before this migration.
do $$
declare
  candidate record;
begin
  for candidate in
    select l.tenant_id, l.id, l.plan_id
    from public.payment_links l
    join public.plans plan
      on plan.tenant_id = l.tenant_id
     and plan.id = l.plan_id
    where plan.kind in ('IMPLEMENTATION', 'CONSULTING')
  loop
    perform public.reclassify_payment_link_as_one_time(
      candidate.tenant_id,
      candidate.id,
      candidate.plan_id
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
