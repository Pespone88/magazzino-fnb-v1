import { useEffect, useMemo, useState } from 'react'
import type { AuthContext } from '../auth/authContext'
import { CatalogWorkspace } from '../catalog/CatalogWorkspace'
import type { CatalogGateway } from '../catalog/catalogGateway'
import { NotificationsPanel } from '../catalog/NotificationsPanel'
import { SuppliersScreen } from '../catalog/SuppliersScreen'
import { canSelectStore, visibleStoreIds } from '../domain/access'
import type { StoreId } from '../domain/store'
import type { StockGateway } from '../stock/stockGateway'
import { StockMovementsScreen } from '../stock/StockMovementsScreen'
import { MoreScreen } from './MoreScreen'
import { primaryNavigation, type NavigationKey } from './navigation'

const sectionCopy: Record<NavigationKey, { title: string; description: string }> = {
  home: { title: 'Da fare', description: 'Attività operative e moduli disponibili nello store selezionato.' },
  articles: { title: 'Articoli', description: 'Catalogo dello store, stock reale, soglie operative e fornitori associati.' },
  orders: { title: 'Ordini', description: 'Il flusso ordini sarà attivato dopo catalogo, ricezioni e movimenti.' },
  more: { title: 'Altro', description: 'Fornitori, movimenti, notifiche e accesso ai prossimi moduli operativi.' },
}

export type CatalogScreenState =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'detail'; storeArticleId: string }

type MoreTarget = 'menu' | 'suppliers' | 'notifications' | 'movements'

type AppShellProps = {
  context: AuthContext
  gateway: CatalogGateway
  stockGateway: StockGateway
  onSignOut(): Promise<void>
}

function displayName(context: AuthContext): string {
  const name = [context.profile.firstName, context.profile.lastName].filter(Boolean).join(' ')
  return name || 'Utente'
}

export function AppShell({ context, gateway, stockGateway, onSignOut }: AppShellProps) {
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
  const [catalogScreen, setCatalogScreen] = useState<CatalogScreenState>({ kind: 'list' })
  const [moreTarget, setMoreTarget] = useState<MoreTarget>('menu')
  const [movementArticleFilter, setMovementArticleFilter] = useState<string | undefined>()
  const activeCopy = sectionCopy[activeSection]
  const activeStore = allowedStores.find((store) => store.id === activeStoreId)
  const isAdmin = context.actor.globalRole === 'ADMIN'

  useEffect(() => {
    if (!allowedStores.some((store) => store.id === activeStoreId)) {
      setActiveStoreId(allowedStores[0]?.id ?? '')
    }
  }, [activeStoreId, allowedStores])

  const changeStore = (storeId: StoreId) => {
    setActiveStoreId(storeId)
    setCatalogScreen({ kind: 'list' })
    setMoreTarget('menu')
    setMovementArticleFilter(undefined)
  }

  const openSection = (section: NavigationKey) => {
    setActiveSection(section)
    if (section !== 'articles') setCatalogScreen({ kind: 'list' })
    if (section !== 'more') {
      setMoreTarget('menu')
      setMovementArticleFilter(undefined)
    }
  }

  const openNewArticle = () => {
    if (!isAdmin) return
    setActiveSection('articles')
    setCatalogScreen({ kind: 'create' })
    setMoreTarget('menu')
    setMovementArticleFilter(undefined)
  }

  const openMovements = (storeArticleId?: string) => {
    setActiveSection('more')
    setMoreTarget('movements')
    setMovementArticleFilter(storeArticleId)
    setCatalogScreen({ kind: 'list' })
  }

  const activeMembership = context.actor.memberships.find(
    (membership) => membership.storeId === activeStoreId,
  )
  const roleLabel = isAdmin ? 'Admin' : (activeMembership?.role ?? 'Utente')

  const content = (() => {
    if (activeSection === 'articles') {
      return (
        <CatalogWorkspace
          actor={context.actor}
          gateway={gateway}
          stockGateway={stockGateway}
          onOpenMovementsForArticle={(storeArticleId) => openMovements(storeArticleId)}
          onScreenChange={setCatalogScreen}
          screen={catalogScreen}
          storeId={activeStoreId}
          stores={allowedStores}
        />
      )
    }

    if (activeSection === 'more' && moreTarget === 'menu') {
      return (
        <section className="content-panel">
          <span className="eyebrow">{activeStore?.name ?? 'Nessuno store'}</span>
          <h1>{activeCopy.title}</h1>
          <p>{activeCopy.description}</p>
          <MoreScreen
            onOpenMovements={() => openMovements()}
            onOpenNotifications={() => setMoreTarget('notifications')}
            onOpenSuppliers={() => setMoreTarget('suppliers')}
          />
        </section>
      )
    }

    if (activeSection === 'more' && moreTarget !== 'menu') {
      const title = moreTarget === 'suppliers' ? 'Fornitori' : moreTarget === 'notifications' ? 'Notifiche' : 'Movimenti'
      return (
        <section className="content-panel">
          <button className="text-button" onClick={() => { setMoreTarget('menu'); setMovementArticleFilter(undefined) }} type="button">← Altro</button>
          <span className="eyebrow">{activeStore?.name ?? 'Nessuno store'}</span>
          <h1>{title}</h1>
          <p>Il modulo usa esclusivamente i dati autorizzati dello store selezionato.</p>
          {moreTarget === 'suppliers' && <SuppliersScreen actor={context.actor} gateway={gateway} storeId={activeStoreId} />}
          {moreTarget === 'notifications' && <NotificationsPanel gateway={gateway} storeId={activeStoreId} />}
          {moreTarget === 'movements' && (
            <StockMovementsScreen
              actor={context.actor}
              catalogGateway={gateway}
              gateway={stockGateway}
              initialStoreArticleId={movementArticleFilter}
              storeId={activeStoreId}
            />
          )}
        </section>
      )
    }

    return (
      <section className="content-panel">
        <span className="eyebrow">{activeStore?.name ?? 'Nessuno store'}</span>
        <h1>{activeCopy.title}</h1>
        <p>{activeCopy.description}</p>
        {activeSection === 'home' && (
          <div className="foundation-card">
            <strong>Accesso protetto</strong>
            <p>Profilo, ruolo e store vengono caricati da Supabase e filtrati dalle policy RLS del database.</p>
          </div>
        )}
      </section>
    )
  })()

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar" aria-label="Navigazione principale">
        <div className="brand-block"><span className="brand-mark">M</span><div><strong>Magazzini F&amp;B</strong><small>V1</small></div></div>
        <nav className="desktop-nav">
          {primaryNavigation.map((item) => (
            <button className={item.key === activeSection ? 'nav-button active' : 'nav-button'} key={item.key} onClick={() => openSection(item.key)} type="button">{item.label}</button>
          ))}
          <button className="desktop-create-button" disabled={!isAdmin} onClick={openNewArticle} type="button">+ Nuovo articolo</button>
        </nav>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">STORE</span>
            {canSelectStore(context.actor) ? (
              <select aria-label="Store attivo" className="store-select" onChange={(event) => changeStore(event.target.value)} value={activeStoreId}>
                {allowedStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            ) : <strong>{activeStore?.name ?? 'Nessuno store assegnato'}</strong>}
          </div>
          <div className="account-menu"><div className="account-copy"><strong>{displayName(context)}</strong><span className="role-chip">{roleLabel}</span></div><button className="logout-button" onClick={() => void onSignOut()} type="button">Esci</button></div>
        </header>
        {content}
      </main>

      <nav className="mobile-bottom-nav" aria-label="Navigazione mobile">
        {primaryNavigation.slice(0, 2).map((item) => <button aria-current={item.key === activeSection ? 'page' : undefined} className={item.key === activeSection ? 'mobile-nav-button active' : 'mobile-nav-button'} key={item.key} onClick={() => openSection(item.key)} type="button">{item.shortLabel}</button>)}
        <button aria-label="Nuovo articolo" className="mobile-create-button" disabled={!isAdmin} onClick={openNewArticle} type="button">+</button>
        {primaryNavigation.slice(2).map((item) => <button aria-current={item.key === activeSection ? 'page' : undefined} className={item.key === activeSection ? 'mobile-nav-button active' : 'mobile-nav-button'} key={item.key} onClick={() => openSection(item.key)} type="button">{item.shortLabel}</button>)}
      </nav>
    </div>
  )
}
