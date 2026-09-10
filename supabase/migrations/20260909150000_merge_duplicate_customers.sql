create or replace function public.merge_customer_records(p_tenant uuid, p_keep uuid, p_merge uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare merge_ids uuid[]; merged_count integer; keep_email text;
begin
  if auth.role() <> 'service_role' then raise exception 'Operação exclusiva do serviço interno.'; end if;
  select lower(trim(email)) into keep_email from public.customers where tenant_id=p_tenant and id=p_keep;
  if keep_email is null then
    raise exception 'Cliente principal não encontrado.';
  end if;
  select coalesce(array_agg(id), '{}'::uuid[]) into merge_ids from public.customers
  where tenant_id=p_tenant and id=any(p_merge) and id<>p_keep;
  merged_count:=cardinality(merge_ids);
  if merged_count=0 then return jsonb_build_object('merged',0); end if;
  if exists (select 1 from public.customers where tenant_id=p_tenant and id=any(merge_ids) and lower(trim(email))<>keep_email) then
    raise exception 'Somente cadastros com o mesmo e-mail podem ser consolidados.';
  end if;

  update public.customers keep set
    responsible_name=coalesce(keep.responsible_name,source.responsible_name),
    phone=coalesce(keep.phone,source.phone), city=coalesce(keep.city,source.city),
    state=coalesce(keep.state,source.state), service_area=coalesce(keep.service_area,source.service_area),
    acquisition_actor_id=coalesce(keep.acquisition_actor_id,source.acquisition_actor_id),
    signed_at=coalesce(keep.signed_at,source.signed_at), cancelled_at=coalesce(keep.cancelled_at,source.cancelled_at),
    cancellation_category=coalesce(keep.cancellation_category,source.cancellation_category),
    cancellation_reason=coalesce(keep.cancellation_reason,source.cancellation_reason),
    comments=coalesce(keep.comments,source.comments), implementation_date=coalesce(keep.implementation_date,source.implementation_date),
    implementation_value=coalesce(keep.implementation_value,source.implementation_value),
    onboarding_completed=keep.onboarding_completed or source.onboarding_completed,
    api_oficial=keep.api_oficial or source.api_oficial
  from lateral (
    select responsible_name,phone,city,state,service_area,acquisition_actor_id,signed_at,cancelled_at,
      cancellation_category,cancellation_reason,comments,implementation_date,implementation_value,onboarding_completed,api_oficial
    from public.customers where tenant_id=p_tenant and id=any(merge_ids) order by created_at asc limit 1
  ) source where keep.tenant_id=p_tenant and keep.id=p_keep;

  update public.subscriptions set customer_id=p_keep where tenant_id=p_tenant and customer_id=any(merge_ids);
  update public.payments set customer_id=p_keep where tenant_id=p_tenant and customer_id=any(merge_ids);
  update public.implementation_payments set customer_id=p_keep where tenant_id=p_tenant and customer_id=any(merge_ids);
  update public.customer_asaas_aliases set customer_id=p_keep where tenant_id=p_tenant and customer_id=any(merge_ids);
  update public.audit_events set entity_id=p_keep::text
    where tenant_id=p_tenant and entity_type='customer' and entity_id in (select id::text from unnest(merge_ids) id);
  update public.audit_events set after_json=jsonb_set(after_json,'{customerId}',to_jsonb(p_keep::text),false)
    where tenant_id=p_tenant and after_json->>'customerId' in (select id::text from unnest(merge_ids) id);
  update public.audit_events set before_json=jsonb_set(before_json,'{customerId}',to_jsonb(p_keep::text),false)
    where tenant_id=p_tenant and before_json->>'customerId' in (select id::text from unnest(merge_ids) id);
  delete from public.customers where tenant_id=p_tenant and id=any(merge_ids);
  return jsonb_build_object('merged',merged_count,'kept',p_keep);
end $$;
revoke all on function public.merge_customer_records(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.merge_customer_records(uuid,uuid,uuid[]) to service_role;
notify pgrst,'reload schema';
