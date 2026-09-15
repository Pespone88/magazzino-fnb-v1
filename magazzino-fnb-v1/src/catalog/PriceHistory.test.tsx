import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PurchasePriceHistoryEntry } from './types'
import { PriceHistory } from './PriceHistory'

afterEach(() => cleanup())

const entries: PurchasePriceHistoryEntry[] = [
  {
    id: 'h-1', packagePrice: 106, packageQuantitySnapshot: 10, baseUnitSnapshot: 'PZ',
    unitPriceSnapshot: 10.6, previousPackagePrice: 100, absoluteChange: 6,
    percentChange: 6, source: 'MANUAL', recordedAt: '2026-09-15T10:00:00Z',
  },
  {
    id: 'h-2', packagePrice: 105, packageQuantitySnapshot: 20, baseUnitSnapshot: 'PZ',
    unitPriceSnapshot: 5.25, previousPackagePrice: 100, absoluteChange: 5,
    percentChange: 5, source: 'RECEIPT', recordedAt: '2026-09-14T10:00:00Z',
  },
]

describe('PriceHistory', () => {
  it('uses DB snapshots and emphasizes only variations above five percent', () => {
    render(<PriceHistory entries={entries} />)
    expect(screen.getByText('€ 10.600000 / PZ')).toBeInTheDocument()
    expect(screen.getByText('€ 5.250000 / PZ')).toBeInTheDocument()
    expect(screen.getByTestId('history-h-1')).toHaveClass('significant-price')
    expect(screen.getByTestId('history-h-2')).not.toHaveClass('significant-price')
  })
})
