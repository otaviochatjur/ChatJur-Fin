# Cobranças via Chat Jurídico

Implementação baseada na skill `agente-financeiro-cobranca.skill` fornecida pelo responsável e no contrato OpenAPI de https://web.chatjuridico.com.br/openapi-pt.yaml (consultado em 07/09/2026).

- API REST: https://api.jur.chat/v1; autenticação `X-API-Key`, exclusivamente no servidor. MCP equivalente: https://api.jur.chat/mcp.
- Relatórios vêm diretamente do Asaas, seguindo o fluxo de `C:\Projetos Claude\Cobrança Asaas`: diário, em aberto e todas as cobranças. Dados e progresso ficam em `collection_reports` e `collection_report_rows`, com retomada por página. As prévias usam o vínculo exato do pagamento Asaas no Chat Jurídico; vínculos ausentes ou ambíguos ficam bloqueados.
- Etapas padrão: -5, 0, 1, 2, 5, 10, 20, 25 e 30 dias; calendário America/Sao_Paulo. Finais de semana e feriados nacionais transferem a ação ao próximo dia útil; convergências usam a menor etapa. D30 não cancela planos automaticamente.
- Regras, categorias, templates e exceções por cliente são editáveis em Cobranças → Configurar régua, salvas por usuário em `collection_settings`. Prioridade: exceção individual, categoria, padrão. Cada relatório guarda a configuração usada em sua geração.
- O Kanban agrupa os clientes do relatório pelo maior atraso no mês de vencimento escolhido. Use Todas as cobranças para incluir pagamentos recebidos; a posição não é uma etapa manual de negociação.
- Contatos consultados por ID, em grupos de até cinco; lista paginada de cobranças, sem paginação do cadastro inteiro.
- Instância financeira especificada pela skill: 46a8a400-70a2-43fd-bfeb-1e286871711b. A chave deve ter acesso a esse canal. Não é utilizado outro canal como alternativa.
- A documentação atual esclarece que um contato pertence a uma instância. Contatos vinculados a outro número ficam para revisão, em vez de seguir a suposição da skill de que `criarConversa` pode movê-los entre números.
- Apenas templates aprovados pt_BR do canal financeiro e variáveis textuais conhecidas são liberados. Mídia, botões, parâmetros desconhecidos e templates ausentes ficam para revisão, sem mensagens inventadas.
- Aprovação individual de texto renderizado, vinculada por HMAC aos dados e ao dia. Pagamento, contato e template são consultados novamente antes do envio.
- Tentativa reivindicada atomicamente por usuário, pagamento, dia e etapa em `audit_events`; idempotência também enviada à API remota. Resultado incerto não é reenviado automaticamente.
- Histórico mensal de tentativas exportável em Excel; registros persistem no banco, sem depender de uma pasta local do Claude. Inativos e demais pendências aparecem na consulta; somente tentativas aprovadas geram registros de envio.

Validação real com templates e permissões depende de cadastrar uma chave válida em Integrações. Nenhuma mensagem foi enviada durante a implementação ou os testes.

## Importação do histórico

`node scripts/import-collection-history.mjs <arquivo-json>` importa o extrato autorizado, preservando data, template, status original e origem. IDs determinísticos por arquivo/aba/linha tornam a repetição idempotente. Setembro de 2026: 103 registros importados, 93 enviados e 10 pulados. Não foram criados vínculos fictícios com pagamentos remotos.

## Renovações anuais

A aba considera planos anuais do catálogo vinculados aos links. A validade começa no primeiro pagamento recebido de cada ciclo de parcelamento e termina no aniversário seguinte. Um novo ciclo pago antecipadamente reinicia o prazo; parcelas posteriores do ciclo anterior não o alteram. Metadados insuficientes ficam sinalizados para revisão. Planos distintos do mesmo cliente continuam separados.

## Tally

Em Integrações → Tally, cadastre o identificador `2EWBOV` e o segredo de assinatura do webhook. No Tally, configure o endereço exibido no sistema e o mesmo segredo. O endereço inclui a conta de destino; a assinatura HMAC do corpo original autentica a entrega e o identificador do formulário é conferido antes da gravação. Respostas repetidas são deduplicadas na conta, e o conteúdo original é preservado em Candidaturas.

O Tally precisa de um endereço público para enviar eventos reais. `node scripts/simulate-tally-local.mjs` executa o receptor em HTTP local com segredo temporário, testa assinatura inválida e reentrega, e mantém uma candidatura identificada como TESTE LOCAL no banco. Esse teste não configura um webhook externo nem salva o segredo temporário em Integrações. Formulário interno local: `/connect/inscricao`.
