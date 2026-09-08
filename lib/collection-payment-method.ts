export function collectionPaymentMethod(value: string | null | undefined) {
  return ({ PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito', UNDEFINED: 'Não informado' } as Record<string,string>)[value ?? ''] ?? value ?? 'Não informado';
}
