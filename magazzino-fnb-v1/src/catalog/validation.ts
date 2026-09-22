export const BASE_UNITS = ['CF', 'PZ', 'KG', 'L'] as const

export function normalizeArticleName(value: string): string {
  return value.trim().toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ')
}

export function parseQuantity(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function formatQuantityForDb(value: number): string {
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export function validateThresholds(minStock: number, targetStock: number): string[] {
  if (minStock < 0 || targetStock < 0) return ['Le quantità non possono essere negative']
  if (targetStock < minStock) return ['L’obiettivo non può essere inferiore al minimo']
  return []
}

export function calculateUnitPrice(packagePrice: number, packageQuantity: number, baseUnit?: typeof BASE_UNITS[number]): number {
  if (packageQuantity <= 0) {
    throw new Error('La quantità per confezione deve essere maggiore di zero')
  }
  return baseUnit === 'CF' ? packagePrice : packagePrice / packageQuantity
}

export function calculatePriceChangePercent(previous: number, next: number): number | null {
  return previous === 0 ? null : ((next - previous) / previous) * 100
}

export function isSignificantPriceChange(previous: number, next: number): boolean {
  const percent = calculatePriceChangePercent(previous, next)
  return percent !== null && Math.abs(percent) > 5
}
