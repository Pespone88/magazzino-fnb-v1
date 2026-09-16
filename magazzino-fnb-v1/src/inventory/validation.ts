import type { InventoryReason } from './types.ts'

export function parseInventoryQuantity(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function formatInventoryQuantityForDb(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value !== Math.round(value * 1000) / 1000) {
    throw new Error('Quantità non valida')
  }
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export function inventoryReasonIsValid(
  reason: InventoryReason | null | undefined,
  note: string | null | undefined,
  required: boolean,
): boolean {
  if (!required) return true
  if (!reason) return false
  if (reason === 'OTHER') return Boolean(note?.trim())
  return true
}
