-- "Sincronizar pagamentos" varria o histórico COMPLETO de pagamentos de
-- TODOS os links a cada clique (sem nenhum filtro de data), mesmo quando já
-- tinha sido sincronizado antes. Para links com muito volume (ex.: um link
-- genérico usado por centenas de clientes ao longo do tempo pode ter
-- milhares de pagamentos), isso levava minutos só para esse link, e a rota
-- processa os links um a um numa única requisição — daí a sensação de "não
-- funciona" (o botão fica girando por muito tempo sem feedback).
--
-- `last_synced_at` guarda até quando cada link já foi varrido, para que
-- reconciliações seguintes só busquem pagamentos criados depois disso (ver
-- app/api/asaas/sync-payments/route.ts). A primeira sincronização de cada
-- link continua completa (coluna começa nula); as seguintes ficam rápidas.
--
-- Idempotente: pode ser re-executada sem erro.

alter table public.payment_links add column if not exists last_synced_at timestamptz;

comment on column public.payment_links.last_synced_at is 'Até quando este link já teve seu histórico de pagamentos varrido pela sincronização com o Asaas. Nulo = nunca sincronizado (próxima sincronização varre o histórico completo); preenchido = próximas sincronizações só buscam pagamentos criados depois desta data.';
