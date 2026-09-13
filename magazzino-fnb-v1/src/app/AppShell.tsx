import { useEffect, useMemo, useState } from 'react'
import type { AuthContext } from '../auth/authContext'
import { canSelectStore, visibleStoreIds } from '../domain/access'
import type { StoreId } from '../domain/store'
import { primaryNavigation, type NavigationKey } from './navigation'

const sectionCopy: Record<NavigationKey, { title: string; description: string }> = {
  home: { title: 'Da fare', description: 'Attività operative, urgenze e pratiche aperte.' },
  articles: { title: 'Articoli', description: 'Catalogo, scorte minime, fornitori e storico delle referenze.' },
  orders: { title: 'Ordini', description: 'Fabbisogni, ordini ai fornitori e ricezioni della merce.' },
  movements: { title: 'Movimenti', description: 'Rifornimenti al punto vendita, resi e prestiti inter-store.' },
  inventories: { title: 'Inventari', description: 'Inventario di apertura, mensile e conteggi straordinari.' },
  more: { title: 'Altro', description: 'Fornitori, anomalie, non conformità, storico e configurazioni.' },
}

type AppShellProps = {
  context: AuthContext
  onSignOut(): Promise<void>
}

function displayName(context: AuthContext): string {
  const name = [context.profile.firstName, context.profile.lastName].filter(Boolean).join(' ')
  return name || 'Utente'
}

export function AppShell({ context, onSignOut }: AppShellProps) {
  const allowedStoreIds = useMemo(
    () => visibleStoreIds(context.actor, context.stores.map((store) => store.id)),
    [context.actor, context.stores],
  )
  const allowedStores = useMemo(
    () => context.stores.filter((store) => allowedStoreIds.includes(store.id)),
    [allowedStoreIds, context.stores],
  )
  const [activeStoreId, setActiveStoreId] = useState<StoreId>(allowedStores[0]?.id ?? '')
  const [activeSection, setActiveSection] = useState<NavigationKey>('home')
  const activeCopy = sectionCopy[activeSection]
  const activeStore = allowedStores.find((store) => store.id === activeStoreId)

  useEffect(() => {
    if (!allowedStores.some((store) => store.id === activeStoreId)) {
      setActiveStoreId(allowedStores[0]?.id ?? '')
    }
  }, [activeStoreId, allowedStores])

  const activeMembership = context.actor.memberships.find(
    (membership) => membership.storeId === activeStoreId,
  )
  const roleLabel = context.actor.globalRole === 'ADMIN'
    ? 'Admin'
    : (activeMembership?.role ?? 'Utente')

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar" aria-label="Navigazione principale">
        <div className="brand-block">
          <span className="brand-mark">M</span>
          <div><strong>Magazzini F&amp;B</strong><small>V1</small></div>
        </div>
        <nav className="desktop-nav">
          {primaryNavigation.map((item) => (
            <button
              className={item.key === activeSection ? 'nav-button active' : 'nav-button'}
              key={item.key}
              onClick={() => setActiveSection(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">STORE</span>
            {canSelectStore(context.actor) ? (
              <select
                aria-label="Store attivo"
                className="store-select"
                onChange={(event) => setActiveStoreId(event.target.value)}
                value={activeStoreId}
              >
                {allowedStores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            ) : (
              <strong>{activeStore?.name ?? 'Nessuno store assegnato'}</strong>
            )}
          </div>
          <div className="account-menu">
            <div className="account-copy">
              <strong>{displayName(context)}</strong>
              <span className="role-chip">{roleLabel}</span>
            </div>
            <button className="logout-button" onClick={() => void onSignOut()} type="button">Esci</button>
          </div>
        </header>

        <section className="content-panel">
          <span className="eyebrow">{activeStore?.name ?? 'Nessuno store'}</span>
          <h1>{activeCopy.title}</h1>
          <p>{activeCopy.description}</p>
          <div className="foundation-card">
            <strong>Accesso protetto</strong>
            <p>Profilo, ruolo e store vengono caricati da Supabase e filtrati dalle policy RLS del database.</p>
          </div>
        </section>
      </main>

      <nav className="mobile-bottom-nav" aria-label="Navigazione mobile">
        {primaryNavigation.map((item) => (
          <button
            aria-current={item.key === activeSection ? 'page' : undefined}
            className={item.key === activeSection ? 'mobile-nav-button active' : 'mobile-nav-button'}
            key={item.key}
            onClick={() => setActiveSection(item.key)}
            type="button"
          >
            {item.shortLabel}
          </button>
        ))}
      </nav>
    </div>
  )
}
