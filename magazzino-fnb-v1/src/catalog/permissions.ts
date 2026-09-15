import type { ActorAccess } from '../domain/roles.ts'

export function canManageCatalog(actor: ActorAccess): boolean {
  return actor.globalRole === 'ADMIN'
}
