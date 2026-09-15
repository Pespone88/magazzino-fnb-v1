import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogGateway } from './catalogGateway'
import { NotificationsPanel } from './NotificationsPanel'

afterEach(() => cleanup())

function gateway() {
  return {
    listMyNotifications: vi.fn().mockResolvedValue([{ id: 'n-1', storeId: 'ecc', severity: 'SIGNIFICANT', title: 'Variazione prezzo', body: 'Olio EVO: 25 € → 27,50 €', entityType: 'STORE_ARTICLE_SUPPLIER', entityId: 'link-1', readAt: null, createdAt: '2026-09-15T10:00:00Z' }]),
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
  } as unknown as CatalogGateway
}

describe('NotificationsPanel', () => {
  it('highlights unread significant notifications and marks only read state through gateway', async () => {
    const user = userEvent.setup()
    const fake = gateway()
    render(<NotificationsPanel gateway={fake} storeId="ecc" />)

    expect(await screen.findByText('Variazione prezzo')).toBeInTheDocument()
    expect(screen.getByTestId('notification-n-1')).toHaveClass('significant-price')
    expect(screen.getByText('Da leggere')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Segna come letta' }))
    expect(fake.markNotificationRead).toHaveBeenCalledWith('n-1')
    expect(await screen.findByText('Letta')).toBeInTheDocument()
  })
})
