import { AppShell } from './app/AppShell'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { LoginScreen } from './auth/LoginScreen'
import { createSupabaseCatalogGateway } from './catalog/supabaseCatalogGateway'
import { createSupabaseInventoryGateway } from './inventory/supabaseInventoryGateway'
import { supabase } from './lib/supabaseClient'
import { createSupabaseOrdersGateway } from './orders/supabaseOrdersGateway'
import { createSupabaseStockGateway } from './stock/supabaseStockGateway'

const catalogGateway = createSupabaseCatalogGateway(
  supabase as unknown as Parameters<typeof createSupabaseCatalogGateway>[0],
)
const inventoryGateway = createSupabaseInventoryGateway(
  supabase as unknown as Parameters<typeof createSupabaseInventoryGateway>[0],
)
const stockGateway = createSupabaseStockGateway(
  supabase as unknown as Parameters<typeof createSupabaseStockGateway>[0],
)
const ordersGateway = createSupabaseOrdersGateway(
  supabase as unknown as Parameters<typeof createSupabaseOrdersGateway>[0],
)

function AuthenticatedApplication() {
  const { state, signOut, reload } = useAuth()

  if (state.status === 'loading') {
    return <main className="auth-page"><section className="auth-card compact-card" aria-live="polite"><strong>Caricamento accesso…</strong></section></main>
  }

  if (state.status === 'signedOut') return <LoginScreen />

  if (state.status === 'error') {
    return (
      <main className="auth-page">
        <section className="auth-card compact-card">
          <span className="eyebrow">ACCESSO BLOCCATO</span>
          <h1>Account non disponibile</h1>
          <p>{state.message}</p>
          <div className="button-row">
            <button className="primary-button" onClick={() => void reload()} type="button">Riprova</button>
            <button className="secondary-button" onClick={() => void signOut()} type="button">Esci</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <AppShell
      context={state.context}
      gateway={catalogGateway}
      inventoryGateway={inventoryGateway}
      ordersGateway={ordersGateway}
      stockGateway={stockGateway}
      onSignOut={signOut}
    />
  )
}

export default function App() {
  return <AuthProvider><AuthenticatedApplication /></AuthProvider>
}
