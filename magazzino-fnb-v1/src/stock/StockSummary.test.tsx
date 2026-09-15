import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StockBalance } from './types'
import { StockSummary } from './StockSummary'

const balance: StockBalance = {
  storeArticleId: 'sa-1',
  storeId: 'store-1',
  onHand: 20,
  reserved: 5,
  available: 15,
  currentUnitCost: 1.25,
  currentValue: 25,
}

describe('StockSummary', () => {
  it('shows physical, reserved, available and current value', () => {
    render(<StockSummary balance={balance} unit="PZ" />)
    expect(screen.getByText('Fisico')).toBeInTheDocument()
    expect(screen.getByText('20 PZ')).toBeInTheDocument()
    expect(screen.getByText('Riservato')).toBeInTheDocument()
    expect(screen.getByText('5 PZ')).toBeInTheDocument()
    expect(screen.getByText('15 PZ')).toBeInTheDocument()
    expect(screen.getByText('€ 25,00')).toBeInTheDocument()
  })

  it('does not invent a warehouse value when receipt cost is missing', () => {
    render(<StockSummary balance={{ ...balance, reserved: 0, available: 20, currentUnitCost: null, currentValue: null }} unit="PZ" />)
    expect(screen.queryByText('Riservato')).not.toBeInTheDocument()
    expect(screen.getByText('Valore non disponibile')).toBeInTheDocument()
  })
})
