-- "Consultoria" é outro produto de taxa única, como "Implantação": nunca
-- gera assinatura/MRR. Reaproveita a mesma tabela `implementation_payments`
-- (cada linha carrega `plan_id`, e o `kind` do plano vinculado já diz se é
-- implantação ou consultoria — não precisa de coluna nova).
--
-- Idempotente: pode ser re-executada sem erro.

do $$
begin
  alter table public.plans drop constraint if exists plans_kind_check;
  alter table public.plans add constraint plans_kind_check check (kind in ('RECURRING', 'IMPLEMENTATION', 'CONSULTING'));
exception when duplicate_object then null;
end $$;

comment on column public.plans.kind is 'RECURRING = plano de assinatura, entra no MRR. IMPLEMENTATION e CONSULTING = taxa única (implantação ou consultoria/assessoria avulsa), nunca geram assinatura — pagamentos vão para implementation_payments.';
