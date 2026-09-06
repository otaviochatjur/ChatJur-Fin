-- Implantação e Consultoria não têm um "preço de tabela" único de verdade
-- (cada link pode ser negociado com um valor diferente), então o valor
-- padrão do plano passa a ser opcional para essas duas categorias. Planos
-- recorrentes continuam exigindo um valor padrão (é a sugestão usada ao
-- gerar links para atores). NULL já satisfaz "standard_value > 0" no
-- Postgres (CHECK só rejeita quando a expressão avalia para FALSE), então
-- só falta remover o NOT NULL.
--
-- Idempotente: pode ser re-executada sem erro.

alter table public.plans alter column standard_value drop not null;

comment on column public.plans.standard_value is 'Preço de referência do plano. Obrigatório para RECURRING (sugestão ao gerar links); opcional para IMPLEMENTATION/CONSULTING, cujo valor real varia por link/negociação.';
