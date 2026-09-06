-- Um pagamento de implantação/consultoria nem sempre passa por um link do
-- Asaas (ex.: Wilker pagou uma consultoria fora do sistema, por transferência
-- direta). `implementation_payments.asaas_payment_id` era NOT NULL + UNIQUE
-- porque, até aqui, toda linha vinha só da sincronização do Asaas
-- (`lib/payment-sync.ts`). Isso passa a ser opcional para permitir o registro
-- manual desses eventos — mesma lógica já aplicada a `subscriptions.source`
-- em 202609052030_manual_subscription_source.sql. UNIQUE continua valendo
-- para quem tem asaas_payment_id: Postgres não considera NULLs duplicados
-- entre si, então múltiplas linhas manuais (sem asaas_payment_id) convivem
-- sem conflito.
--
-- Idempotente: pode ser re-executada sem erro.

alter table public.implementation_payments alter column asaas_payment_id drop not null;

alter table public.implementation_payments add column if not exists source text not null default 'SYSTEM';

do $$
begin
  alter table public.implementation_payments drop constraint if exists implementation_payments_source_check;
  alter table public.implementation_payments add constraint implementation_payments_source_check check (source in ('SYSTEM', 'MANUAL'));
exception when duplicate_object then null;
end $$;

comment on column public.implementation_payments.source is 'SYSTEM = sincronizado automaticamente de um pagamento real no Asaas. MANUAL = registrado à mão pelo operador (pagamento fora do Asaas: transferência, dinheiro, etc.).';
comment on column public.implementation_payments.asaas_payment_id is 'ID do pagamento no Asaas. NULL quando source=MANUAL (evento sem pagamento no Asaas por trás).';
