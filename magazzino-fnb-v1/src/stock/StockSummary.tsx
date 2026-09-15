import type { StockBalance } from './types'

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 }).format(value)
}

function formatCurrency(value: number): string {
  return `€ ${new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`
}

type StockSummaryProps = {
  balance: StockBalance
  unit: 'CF' | 'PZ' | 'KG' | 'L'
}

export function StockSummary({ balance, unit }: StockSummaryProps) {
  return (
    <div className="stock-summary" aria-label="Riepilogo magazzino">
      <div className="stock-metric">
        <span>Fisico</span>
        <strong>{formatQuantity(balance.onHand)} {unit}</strong>
      </div>
      {balance.reserved > 0 && (
        <div className="stock-metric">
          <span>Riservato</span>
          <strong>{formatQuantity(balance.reserved)} {unit}</strong>
        </div>
      )}
      <div className="stock-metric">
        <span>Disponibile</span>
        <strong>{formatQuantity(balance.available)} {unit}</strong>
      </div>
      <div className="stock-metric">
        <span>Valore corrente</span>
        <strong>{balance.currentValue === null ? 'Valore non disponibile' : formatCurrency(balance.currentValue)}</strong>
      </div>
    </div>
  )
}
