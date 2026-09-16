import type { AppNotification, CatalogGateway } from './catalogGateway.ts'
import { createSupabaseCatalogGateway } from './supabaseCatalogGateway.ts'

type DbRow = Record<string, unknown>

function asRows(value: unknown): DbRow[] {
  return Array.isArray(value)
    ? value.filter((item): item is DbRow => item !== null && typeof item === 'object')
    : []
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Campo ${field} non valido`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value, 'testo')
}

export function mapNotificationRow(row: DbRow): AppNotification {
  const severity = requiredString(row.severity, 'notification.severity')
  if (severity !== 'NORMAL' && severity !== 'SIGNIFICANT') {
    throw new Error('Severità notifica non valida')
  }

  return {
    id: requiredString(row.id, 'notification.id'),
    storeId: nullableString(row.store_id),
    type: optionalString(row.type),
    severity,
    title: requiredString(row.title, 'notification.title'),
    body: requiredString(row.body, 'notification.body'),
    entityType: requiredString(row.entity_type, 'notification.entity_type'),
    entityId: requiredString(row.entity_id, 'notification.entity_id'),
    readAt: nullableString(row.read_at),
    createdAt: requiredString(row.created_at, 'notification.created_at'),
  }
}

export function createSupabaseCatalogGatewayWithNotifications(
  client: Parameters<typeof createSupabaseCatalogGateway>[0],
): CatalogGateway {
  const base = createSupabaseCatalogGateway(client)

  return {
    ...base,
    async listMyNotifications() {
      const { data, error } = await client.from('notifications').select(`
        id, store_id, type, severity, title, body, entity_type, entity_id, read_at, created_at
      `).order('created_at', { ascending: false })

      if (error) throw new Error(error.message || 'Notifiche non disponibili')
      return asRows(data).map(mapNotificationRow)
    },
  }
}
