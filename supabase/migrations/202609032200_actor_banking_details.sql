-- Personal/banking data for commercial actors (Parceiros, Embaixadores,
-- Comerciais externos e internos), needed to actually execute a repasse
-- transfer and to print it on the accounting/partner reports generated
-- from the "Repasses" tab.

alter table public.commercial_actors add column if not exists document text; -- CPF ou CNPJ
alter table public.commercial_actors add column if not exists pix_key text;
alter table public.commercial_actors add column if not exists bank_name text;
alter table public.commercial_actors add column if not exists bank_agency text;
alter table public.commercial_actors add column if not exists bank_account text;
alter table public.commercial_actors add column if not exists bank_account_type text check (bank_account_type is null or bank_account_type in ('CORRENTE', 'POUPANCA'));
alter table public.commercial_actors add column if not exists bank_notes text; -- catch-all for anything not covered above (nome do titular, CNPJ da conta, etc.)

comment on column public.commercial_actors.document is 'CPF ou CNPJ do parceiro/embaixador/comercial, usado no relatório de repasses para a contabilidade.';
comment on column public.commercial_actors.pix_key is 'Chave Pix preferencial para receber o repasse.';
comment on column public.commercial_actors.bank_notes is 'Dados bancários adicionais em texto livre (ex.: nome do titular, se diferente do cadastro).';
