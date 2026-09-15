import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '../auth/authContext'
import type { CatalogGateway } from '../catalog/catalogGateway'
import { AppShell } from './AppShell'

const context: AuthContext = {
  profile: {
    id: 'admin-1',
    globalRole: 'ADMIN',
    active: true,
    firstName: 'Peppe',
    lastName: 'Esposito',
  },
  actor: { globalRole: 'ADMIN', memberships: [] },
  stores: [
    { id: 'store-eccellenze', name: 'Eccellenze della Costiera' },
    { id: 'store-nonna-titti', name: 'Nonna Titti' },
  ],
}

const gateway = {
  listCategories: vi.fn().mockResolvedValue([]),
  listStoreArticles: vi.fn().mockResolvedValue([]),
} as unknown as CatalogGateway

describe('AppShell', () => {
  it('keeps the store context and approved five-slot mobile navigation', async () => {
    const user = userEvent.setup()
    render(<AppShell context={context} gateway={gateway} onSignOut={vi.fn()} />)

    expect(screen.getByLabelText('Store attivo')).toBeInTheDocument()

    const mobileNav = screen.getByRole('navigation', { name: 'Navigazione mobile' })
    expect(mobileNav).toHaveTextContent('Home')
    expect(mobileNav).toHaveTextContent('Articoli')
    expect(mobileNav).toHaveTextContent('Ordini')
    expect(mobileNav).toHaveTextContent('Altro')
    expect(screen.getByRole('button', { name: 'Nuovo articolo' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Nuovo articolo' }))
    expect(screen.getByRole('heading', { name: 'Nuovo articolo' })).toBeInTheDocument()

    expect(document.body.textContent).not.toMatch(/RATIO/i)
    expect(document.body.textContent).not.toMatch(/Valore magazzino|Sotto minimo|Giacenza/i)
  })
})
