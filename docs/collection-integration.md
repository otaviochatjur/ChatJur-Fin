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

Em Integrações → Tally, cadastre a chave de API pessoal (Tally → Configurações da conta → API) e o identificador do formulário (`2EWBOV`). A chave é validada contra a API do Tally no momento do salvamento. O botão "Sincronizar candidaturas" (mesma tela) busca todas as respostas do formulário via `GET /forms/{id}/submissions` e importa as que ainda não existem em Candidaturas — dedup por `tally_submission_id`, dentro da conta. Não depende de nenhum webhook configurado no painel do Tally: só da chave de API salva. Formulário interno local: `/connect/inscricao`.

Substitui a integração anterior por webhook (assinatura HMAC + endereço público exigido pelo Tally): a chave de API pessoal cobre tanto o histórico quanto novas respostas, sem exigir um endereço público acessível a partir do Tally.


## Seleção e disparo de cobranças

Em Cobranças, prepare as prévias de um relatório concluído de hoje, marque as cobranças aptas e use Aprovar e enviar selecionadas. A seleção corresponde a cada cobrança, com o texto e o destinatário exibidos. Contatos com várias cobranças podem receber várias mensagens. O lote é sequencial; cada envio passa pela mesma revalidação de pagamento, contato, template e aprovação da rota individual. Falhas ou respostas incertas interrompem o restante, sem repetição automática. Pausar aguarda a mensagem em andamento; sair da seção também impede novos envios do lote. O histórico no banco registra as tentativas.

## Escolha do formulário Tally

Em Integrações, Buscar meus formulários lista os nomes disponíveis para a chave informada ou já salva. Selecione um, salve e use Sincronizar candidaturas. Apenas respostas concluídas são importadas. Trocar o formulário preserva as candidaturas anteriores. O token continua criptografado e não volta ao navegador. Consultas à API funcionam localmente, sem webhook público; novas respostas são buscadas quando a sincronização é acionada.

## Clientes do Connect

A contagem considera clientes distintos vinculados ao responsável atual do link, incluindo assinaturas sem status confirmado. MRR e elegibilidade Plus continuam baseados nos ativos, separadamente da contagem de clientes vinculados.


## Desempenho dos relatórios

Todas as cobranças consulta 100 pagamentos por página (limite documentado do Asaas); os modos com Pix mantêm páginas de 25. Cadastros de clientes são reutilizados em memória por conta e execução, com limites de tamanho e expiração por inatividade. Reinícios ou troca de processo podem exigir nova consulta do cadastro, sem afetar os registros já salvos. Falhas não são memorizadas. Cinco consultas trabalham continuamente, sem esperar o item mais lento de cada grupo. A contagem final lê apenas IDs, preservando a contagem exata de registros únicos, e a abertura consulta cabeçalho, linhas e revisão em paralelo.

O ganho real depende da quantidade de clientes distintos, da disponibilidade do Asaas e da reutilização do processo do servidor; não é uma promessa de redução proporcional no tempo total. Um relatório concluído pode ser reaberto sem nova varredura do Asaas.


## Base sincronizada do Asaas (implementada)

`asaas_base_objects` mantém clientes, cobranças e links por usuário e geração; `asaas_base_sync` guarda cursores, progresso, erros, última conferência e último evento. A carga percorre clientes, cobranças e links em páginas de 100; links incluem removidos. Cada nova conferência monta uma geração separada e só a publica ao concluir, em uma transação que também atualiza os snapshots remotos dos links locais. Vínculos, valores contratados e status locais são preservados. Links novos com valor fixo positivo entram pendentes; links variáveis/removidos permanecem no espelho sem criar vínculos fictícios.

O painel verifica a necessidade de nova conferência a cada minuto e faz a consulta completa quando a última carga tem pelo menos uma hora, enquanto o sistema estiver aberto. Há botão manual, pausa e retomada. O botão de sincronizar links usa essa mesma rotina. Não há agendador externo funcionando com o computador desligado.

Os eventos de pagamento autenticados pelo webhook consultam o estado atual no Asaas antes de atualizar as gerações ativa e em andamento. Exclusões viram marcadores e saem da consulta atual. Gravações mais antigas não substituem observações mais recentes. Falhas retornam 503 e deixam o evento pendente para reentrega, em vez de confirmar uma atualização perdida. Esse caminho contínuo depende de uma URL pública configurada no Asaas; localmente, a conferência por API continua funcionando.

Novos relatórios Todas as cobranças leem exclusivamente essa base, com identificação da geração/data de origem, cursor por ID e cópia persistida em collection_report_rows. Os outros modos continuam consultando a API, inclusive dados Pix. Execuções antigas já iniciadas com API podem ser retomadas pelo caminho anterior. Gerações antigas são removidas na conclusão de cargas futuras, preservando a anterior e as necessárias para relatórios ainda em geração; relatórios concluídos mantêm suas próprias linhas.

Validação real em 07/09/2026: 1.143 clientes, 3.975 cobranças e 252 links no espelho; os 240 links locais anteriores conservaram os campos comerciais. Relatório gerado e relido com zero chamadas ao Asaas. Ferramenta de verificação: scripts/initialize-asaas-base.mjs.

## Programação local por usuário

Em **Cobranças → Programação**, cada usuário escolhe o horário de Brasília, ativa/desativa os envios e permite separadamente sábados, domingos e feriados nacionais. O calendário se aplica aos envios programados; a preparação manual mantém o calendário padrão da régua. Etapas que caem em dias não permitidos passam ao próximo permitido, mantendo a prioridade da menor etapa quando convergem.

O coordenador fica montado no painel inteiro e consulta a programação a cada minuto. A execução inicia no horário ou ao abrir o painel depois dele, somente no mesmo dia. É necessário manter o painel aberto, a sessão ativa e o computador conectado; não existe execução em nuvem configurada para esta instalação local. Uma execução já concluída não é reiniciada por alterações de horário no mesmo dia. A fila já iniciada mantém seus candidatos; desativar interrompe os próximos envios, mas não desfaz uma mensagem já em andamento.

A fila diária usa a base sincronizada do Asaas e o vínculo exato do pagamento no Chat Jurídico. Antes de enviar cada item, relê pagamento/cliente no Asaas, contato/template no Chat Jurídico, régua e autorização persistida. Os templates individuais e por categoria prevalecem sobre a régua geral. Contatos ambíguos ou sem vínculo exato não recebem mensagens. A programação não cancela planos ou cobranças.

`collection_schedule` armazena configuração; `collection_schedule_jobs` registra fila, progresso, contadores e erros, com RLS por usuário. Um lease no banco coordena abas simultâneas. O transporte compartilhado com o envio manual usa a mesma identificação única de pagamento/dia/etapa e chaves de idempotência. Tentativas incertas interrompem o lote como `REVIEW_REQUIRED`, exigindo análise do histórico e continuação manual; não há retry automático de mensagens.

## Tally e análise das candidaturas

Com chave e formulário salvos, o painel consulta o Tally a cada minuto enquanto aberto. `tally_sync_state` persiste a última verificação e coordena consultas simultâneas. A restrição única por usuário/submissão impede duplicação. O contador no menu inclui todas as candidaturas pendentes, e atualiza apenas candidaturas sem recarregar as consultas financeiras. O modal apresenta as perguntas e respostas originais do `raw_payload`, inclusive campos não mapeados, anexos e consentimentos, e permite registrar aprovação/classificação ou reprovação.
