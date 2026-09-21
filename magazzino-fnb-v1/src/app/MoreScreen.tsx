type MoreScreenProps = {
  onOpenSuppliers(): void
  onOpenNotifications(): void
  onOpenMovements(): void
  onOpenInventories(): void
}

export function MoreScreen({ onOpenSuppliers, onOpenNotifications, onOpenMovements, onOpenInventories }: MoreScreenProps) {
  return (
    <section className="more-grid" aria-label="Altri moduli">
      <button className="module-card" onClick={onOpenSuppliers} type="button">
        <strong>Fornitori</strong>
        <span>Anagrafiche, associazioni store e condizioni di acquisto.</span>
      </button>
      <button className="module-card" onClick={onOpenNotifications} type="button">
        <strong>Notifiche</strong>
        <span>Variazioni prezzo e avvisi che richiedono attenzione.</span>
      </button>
      <button className="module-card" onClick={onOpenMovements} type="button">
        <strong>Movimenti</strong>
        <span>Giacenze reali, storico, rettifiche e storni autorizzati.</span>
      </button>
      <button className="module-card" onClick={onOpenInventories} type="button">
        <strong>Inventari</strong>
        <span>Apertura, mensile, straordinario, riconteggi e anomalie.</span>
      </button>
    </section>
  )
}
