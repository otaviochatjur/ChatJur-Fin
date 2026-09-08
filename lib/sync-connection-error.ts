export function isSyncConnectionError(error: unknown) {
  return error instanceof Error && (['TimeoutError', 'AbortError'].includes(error.name) || /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(error.message));
}
export function syncErrorMessage(error: unknown) {
  return isSyncConnectionError(error)
    ? 'A conexão com o servidor foi interrompida ou demorou demais. Nova tentativa automática em até um minuto.'
    : error instanceof Error ? error.message : 'Falha na sincronização.';
}
