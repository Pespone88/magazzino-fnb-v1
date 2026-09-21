export function formatOrderQuantityForDb(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value !== Math.round(value * 1000) / 1000) {
    throw new Error('Quantità non valida')
  }
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export function formatOrderPriceForDb(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value !== Math.round(value * 10000) / 10000) {
    throw new Error('Prezzo non valido')
  }
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

export function operationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`
}
