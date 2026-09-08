# Cobrança: elegibilidade e envio a partir da nossa base, não do Chat Jurídico

## Problema

O relatório diário de cobrança (Asaas, "Vencidas e a vencer") mostrava 90 clientes com envio previsto para hoje, mas a etapa "Preparar prévias" retornava 0 elegíveis. Investigação (ver conversa) confirmou a causa raiz: `app/api/collections/route.ts` casa cada cobrança do Asaas com um pagamento *dentro do Chat Jurídico* (`asaas_payment_id`) para descobrir o contato/telefone de destino. A integração Asaas do próprio Chat Jurídico está desconectada desde 2026-03-16 (`statusIntegracaoAsaas` → `is_connected: false`), então nenhum pagamento emitido depois dessa data existe lá. Resultado: 90/90 bloqueados com "Pagamento do Asaas sem vínculo no Chat Jurídico".

Decisão do responsável: não reconectar essa integração agora. A elegibilidade e o telefone de destino devem vir da nossa própria base (`customers`, já sincronizada via nosso próprio Asaas — "Sincronizar pagamentos" — que funciona). O Chat Jurídico continua sendo usado só como canal de envio (WhatsApp).

## Diagnóstico que sustenta o desenho (dados reais, 2026-09-08)

- Relatório de hoje: 90 linhas PENDING/OVERDUE, 84 `customer_id` (Asaas) distintos.
- 69/84 já batem com `customers.asaas_customer_id` na nossa base, todos com telefone.
- `ReportSnapshot` (o próprio relatório do Asaas, `lib/collection-report-types.ts`) já tem um campo `phone` preenchido em 90/90 linhas de hoje, direto do Asaas — mais completo e mais fresco que `customers.phone`. Fonte primária do telefone passa a ser `snapshot.phone`, com `customers.phone` só como reforço se `snapshot.phone` vier vazio.
- `customers.status` está `null` em 746/747 clientes (reset de status de setembro/2026 — mesma causa do bug já corrigido em `computeActorMetrics`). Não dá para exigir `ACTIVE` sem antes reconfirmar.
- A planilha "⭐ Base de Clientes" (fonte usada hoje só na criação de clientes, `lib/clients-allowlist.ts`) tem uma coluna `STATUS` (`Ativo` / `Cancelado` / `Congelada` / vazio) e cobre 100% dos nossos 747 clientes (723 por `office_id`, 24 por e-mail). Aplicando o mapeamento: 482 ficariam `ACTIVE`, 264 `CANCELLED`, 1 `FROZEN`.
- Formato de telefone em `customers.phone`: 707 com 11 dígitos (DDD+celular, sem +55), 34 com 10 (DDD+fixo), 5 já com 55 na frente, 1 vazio.

## Não-objetivos

- Não reconectar/consertar a integração Asaas do Chat Jurídico.
- Não criar sincronização contínua da planilha ⭐ Base de Clientes para clientes já existentes — só um backfill único agora. Depois disso, `customers.status` volta a ser mantido só pelo próprio painel (edição manual, evento de cancelamento), igual já documentado em `lib/clients-allowlist.ts`.
- Não mudar a lógica de templates/estágios da régua (`collectionSchedule`, `COLLECTION_STAGES`) nem a geração do relatório do Asaas — ambos já funcionam e não dependem do Chat Jurídico.

## Parte 1 — Backfill único de `customers.status`

Script novo `scripts/legacy-import/backfill-customer-status-from-sheet.mjs` (padrão dos demais scripts em `scripts/legacy-import/`):

1. Busca todas as linhas da planilha via `CLIENTS_SHEET_WEBHOOK_URL` (mesmo webhook n8n já usado por `lib/clients-allowlist.ts`).
2. Busca todos os `customers` com `status IS NULL` (nunca sobrescreve um status já confirmado manualmente).
3. Casa cada cliente por `external_office_id = office_id` (prioridade); se não achar, tenta por `email` (case-insensitive).
4. Mapeia `STATUS` da planilha → `customers.status`:
   - `"Ativo"` → `ACTIVE`
   - `"Cancelado"` → `CANCELLED`
   - `"Congelada"` → `FROZEN`
   - vazio ou sem match → não mexe (permanece `null`)
5. Aplica os updates em lote (`PATCH` por id, ou um lote pequeno por vez), reportando contagem por categoria e uma lista de quem ficou sem match (esperado: 0, mas o script deve avisar se aparecer algum).
6. Idempotente: rodar de novo não altera nada (porque só mira `status IS NULL`, e depois do primeiro run ninguém mais estará `null` a partir dessa fonte — a menos que um cliente novo apareça sem confirmação).

Sem teste automatizado dedicado (é um script one-off de dados, como os demais em `scripts/legacy-import/`) — verificação é rodar e conferir as contagens reportadas batem com o diagnóstico acima (482/264/1).

## Parte 2 — Elegibilidade a partir da nossa base

`app/api/collections/route.ts` (`GET`) muda a etapa de resolução de contato:

- Hoje: `byAsaas` (map de pagamentos do Chat Jurídico por `asaas_payment_id`) → `match` → `contact_id` → busca contato no Chat Jurídico.
- Novo: para cada `snapshot` do relatório, busca `customers` por `asaas_customer_id = snapshot.customer_id` (uma query em lote com `in.(...)`, não uma por linha).

`lib/collection-policy.ts` (`previewCollection`) muda a assinatura: em vez de receber um `BillingContact | null` do Chat Jurídico, recebe o registro de `customers` (ou `null` se não encontrado). Novas regras de bloqueio, na ordem:

1. `!["PENDING","OVERDUE"].includes(payment.status)` → "Cobrança não está em aberto" (inalterado).
2. `!customer` → "Cliente não encontrado na base" (novo texto; substitui "Pagamento do Asaas sem vínculo no Chat Jurídico").
3. `customer.status !== "ACTIVE"` → "Cliente sem status Ativo confirmado" (substitui o bloqueio por `contact.is_active`).
4. `!stage` → "Sem envio hoje" (inalterado).
5. `!phone` (onde `phone = snapshot.phone || customer.phone || null`, normalizado — ver Parte 4) → "Telefone não cadastrado" (substitui a checagem de `contact.phone`; a checagem de `instance_id === FINANCIAL_INSTANCE` desaparece — não existe mais "instância" do lado da nossa base, isso passa a ser resolvido só no envio, Parte 3).
6. Checagens de template (aprovado, variáveis, mídia/botões) — inalteradas.

Nome usado na variável `{{1}}` do template: `customer.name ?? payment.contact_name ?? ""`, onde `customer.name = dbCustomer.responsible_name ?? dbCustomer.office_name ?? null` é resolvido pelo chamador (route.ts), não por `previewCollection` — a função só recebe um objeto já pronto (ver assinatura no plano).

`BillingPayment.contact_id`/`chat_id` deixam de ser preenchidos/usados nesse fluxo (eram só a ponte para o Chat Jurídico). `previewCollection` passa a receber um novo tipo `BillingCustomer | null` (`{ id, status, phone, name }`) no lugar de `BillingContact | null`, e o `CollectionPreview` resultante carrega esse `customer` (em vez de `contact`) para a Parte 3 usar no envio.

**`POST /api/collections` (disparo de uma cobrança aprovada) também muda**, pelo mesmo motivo: hoje ele re-verifica a prévia buscando `paymentId` como um **UUID do Chat Jurídico** (`chatRequest('/v1/payments/{uuid}')`) para achar o `asaas_payment_id` e o `contact_id`. Sem essa ponte, `paymentId` passa a ser diretamente o **id do pagamento no Asaas** (formato `pay_xxxxxxxxxxxx`) — que é inclusive o único id que `row.payment.id` já tinha na prática, já que o casamento com o Chat Jurídico nunca dá match hoje. Novo fluxo do `POST`:
1. Valida `paymentId` com o formato Asaas (`/^pay_[a-zA-Z0-9]+$/`), não mais UUID.
2. Busca o pagamento fresco direto no Asaas: `asaasRequest<AsaasPayment>('/payments/{paymentId}')`.
3. Busca o cliente fresco direto no Asaas: `asaasRequest<AsaasCustomer>('/customers/{source.customer}')` (já dá nome e telefone — `mobilePhone ?? phone`).
4. Busca nosso `customers` por `asaas_customer_id = source.customer` (Supabase).
5. Monta `customer: BillingCustomer` com `phone = normalizePhone(asaasCustomer.mobilePhone ?? asaasCustomer.phone) ?? normalizePhone(dbCustomer?.phone)`, `status = dbCustomer?.status ?? null`, `name = dbCustomer?.responsible_name ?? dbCustomer?.office_name ?? null`.
6. Chama `previewCollection` com esse `customer` e segue igual (checa `blocked`/HMAC, chama `dispatchCollection`).

## Parte 3 — Envio: resolver/criar contato do Chat Jurídico pelo telefone

`lib/collection-dispatch.ts` (`dispatchCollection`) hoje abre a conversa direto com `payment.contact_id` (vindo do Chat Jurídico). Novo fluxo, antes de criar a conversa:

1. `GET /v1/contacts?phone=<normalizado>` (ou o parâmetro equivalente de busca por telefone já usado por `listarContatos`), filtrando pela instância Financeira.
2. Se encontrar exatamente um contato: usa esse `contact_id`.
3. Se não encontrar: `POST /v1/contacts` com `{ name, phone, instance_id: FINANCIAL_INSTANCE }` para criar um novo.
4. Segue o fluxo já existente: `POST /v1/conversations` (idempotente, já com `idempotencyKey`) e depois o envio do template.
5. Erros de rede/API na busca ou criação do contato propagam como falha do envio dessa cobrança específica (mesmo tratamento de erro que já existe: marca `REVIEW_REQUIRED` no `audit_events` e pede revisão manual) — não interrompe o lote inteiro.

O aprovador HMAC (`approval()` em `app/api/collections/route.ts`) e a claim atômica por `tenant:payment:day:stage` em `audit_events` continuam exatamente iguais — nada muda na idempotência/segurança do envio em si.

## Parte 5 — Programação automática (`lib/collection-schedule-server.ts`)

Existe um **segundo** caminho de envio, totalmente automático (aba "Programação" em Cobranças, acionado por `POST /api/collections/schedule {action:"tick"}` → `advanceSchedule()`), com o **mesmo problema**: `queueForToday` calcula quais pagamentos do Asaas (`asaas_base_payments`, nossa base já sincronizada) têm estágio previsto para hoje, mas depois cruza isso com `chatList("/v1/payments?...")` do Chat Jurídico só para descobrir o `contact_id` — e como essa integração está quebrada, `byAsaas` nunca acha nada, então `queueForToday` sempre retorna uma lista vazia. Na prática: o job de hoje fecha como `COMPLETE` com 0 enviados, todo dia, silenciosamente, desde março.

Correção (mesmo princípio da Parte 2, reaproveitando a mesma função de resolução):

- `queueForToday` para de cruzar com o Chat Jurídico — `eligible` já é um `Set` dos **ids de pagamento do Asaas** (`external_id` de `asaas_base_payments`, que já é o `pay_xxx`), então a função só precisa devolver `[...eligible]` diretamente. `job.payment_ids` passa a guardar ids do Asaas, não mais UUIDs do Chat Jurídico.
- Dentro de `advanceSchedule`, o passo que processa cada id (hoje: busca o pagamento no Chat Jurídico por UUID, depois no Asaas, depois o contato) passa a: buscar direto no Asaas (`asaasRequest`), buscar o cliente no Asaas (`fetchAsaasCustomer`, para nome/telefone), buscar nosso `customers` por `asaas_customer_id`, montar o `BillingCustomer` e chamar `previewCollection` — exatamente o mesmo padrão da Parte 2 (POST). Para não duplicar essa montagem em dois arquivos, a função que constrói o `BillingCustomer` a partir de uma linha de `customers` (`toBillingCustomer`) passa a viver em `lib/collection-policy.ts` (função pura, sem I/O) e é importada tanto por `app/api/collections/route.ts` quanto por `lib/collection-schedule-server.ts`.
- O resto do fluxo (lease atômico em `collection_schedule_jobs`, verificação de `scheduleDue`/config antes de cada envio, chamada a `dispatchCollection`) não muda.

## Parte 4 — Normalização de telefone

Função nova (`lib/collection-policy.ts`) que recebe um telefone bruto — de `snapshot.phone` (já dígitos puros, ex: `11940777545`) ou de `customers.phone` (formatado, ex: `(11) 94077-7545`, `(15) 3224-3271`, ou já com 55 na frente) — e retorna dígitos puros no formato que o Chat Jurídico espera (`5511940777545`):

- Remove tudo que não é dígito.
- Se já começa com `55` e tem 12 ou 13 dígitos, mantém.
- Se tem 10 ou 11 dígitos (DDD + fixo/celular), prefixa `55`.
- Qualquer outro formato (muito curto, muito longo) → inválido, tratado como "sem telefone" (bloqueia com "Telefone não cadastrado/inválido").

## Testes

- `tests/collection-policy.test.mjs` (já existe): atualizar/adicionar casos para `previewCollection` com a nova assinatura (customer em vez de contact), cobrindo os 5 motivos de bloqueio novos/alterados e o caminho feliz.
- Novo teste para a normalização de telefone (tabela de casos: os 4 formatos reais encontrados + um inválido).
- Novo teste para `dispatchCollection` cobrindo: contato já existe (reaproveita), contato não existe (cria), e falha na criação do contato (marca `REVIEW_REQUIRED`, não trava o restante do lote) — seguindo o padrão de mock de `fetch` já usado em `tests/integrations.test.mjs`.
- Suíte completa (`node --test tests/*.test.mjs`) e `npm run build` antes de considerar concluído, como já é praxe neste projeto.

## Rollout

1. Rodar o backfill (Parte 1) primeiro, sozinho, e conferir as contagens reportadas.
2. Implementar e testar as Partes 2–4.
3. Gerar um novo relatório do dia e clicar em "Preparar prévias" para confirmar visualmente que os 90 (ou o número do dia) aparecem como elegíveis com os motivos de bloqueio esperados para os poucos que sobrarem (ex.: `CANCELLED`, sem telefone).
4. Nenhum envio real acontece nesse processo — "Preparar prévias" é só leitura; o disparo continua exigindo aprovação manual (marcar e clicar "Aprovar e enviar selecionadas"), sem mudança nesse contrato.
