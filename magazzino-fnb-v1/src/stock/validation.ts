export function parseSignedStockQuantity(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function formatSignedStockQuantityForDb(value: number): string {
  if (!Number.isFinite(value) || value !== Math.round(value * 1000) / 1000) {
    throw new Error('Quantità non valida')
  }
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
