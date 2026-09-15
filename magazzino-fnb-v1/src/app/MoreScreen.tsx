type MoreScreenProps = {
  onOpenSuppliers(): void
  onOpenNotifications(): void
}

export function MoreScreen({ onOpenSuppliers, onOpenNotifications }: MoreScreenProps) {
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
      <div className="module-card disabled-card" aria-disabled="true">
        <strong>Ricezioni</strong>
        <span>Prossimamente</span>
      </div>
      <div className="module-card disabled-card" aria-disabled="true">
        <strong>Movimenti</strong>
        <span>Prossimamente</span>
      </div>
      <div className="module-card disabled-card" aria-disabled="true">
        <strong>Inventari</strong>
        <span>Prossimamente</span>
      </div>
    </section>
  )
}
