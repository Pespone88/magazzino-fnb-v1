import type { PurchasePriceHistoryEntry } from './types'

type PriceHistoryProps = {
  entries: PurchasePriceHistoryEntry[]
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function PriceHistory({ entries }: PriceHistoryProps) {
  if (entries.length === 0) return <div className="empty-state">Nessuno storico prezzo disponibile.</div>

  return (
    <div className="price-history" aria-label="Storico prezzi">
      {entries.map((entry) => {
        const significant = entry.percentChange !== null && Math.abs(entry.percentChange) > 5
        return (
          <article
            className={significant ? 'history-row significant-price' : 'history-row'}
            data-testid={`history-${entry.id}`}
            key={entry.id}
          >
            <div className="history-main">
              <strong>€ {entry.packagePrice.toFixed(2)} / confezione</strong>
              <span>€ {entry.unitPriceSnapshot.toFixed(6)} / {entry.baseUnitSnapshot}</span>
            </div>
            <div className="history-meta">
              <span>{formatDate(entry.recordedAt)}</span>
              <span>{entry.source === 'RECEIPT' ? 'Ricezione' : 'Manuale'}</span>
              {entry.percentChange !== null && (
                <strong>{entry.percentChange > 0 ? '+' : ''}{entry.percentChange.toFixed(2)}%</strong>
              )}
              <span>{entry.packageQuantitySnapshot} {entry.baseUnitSnapshot} / confezione</span>
            </div>
          </article>
        )
      })}
    </div>
  )
}
