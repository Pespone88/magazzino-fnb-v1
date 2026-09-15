import { useEffect, useState } from 'react'
import type { CatalogGateway, PriceNotification } from './catalogGateway'

type NotificationsPanelProps = {
  gateway: CatalogGateway
  storeId: string
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function NotificationsPanel({ gateway, storeId }: NotificationsPanelProps) {
  const [notifications, setNotifications] = useState<PriceNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void gateway.listMyNotifications()
      .then((rows) => {
        if (!cancelled) setNotifications(rows.filter((row) => row.storeId === null || row.storeId === storeId))
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Notifiche non disponibili')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [gateway, storeId])

  const markRead = async (notificationId: string) => {
    setError(null)
    try {
      await gateway.markNotificationRead(notificationId)
      setNotifications((current) => current.map((row) => (
        row.id === notificationId ? { ...row, readAt: new Date().toISOString() } : row
      )))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Aggiornamento notifica non disponibile')
    }
  }

  if (loading) return <div className="empty-state">Caricamento notifiche…</div>

  return (
    <section className="notification-list">
      {error && <div className="form-error" role="alert">{error}</div>}
      {notifications.map((notification) => (
        <article
          className={notification.severity === 'SIGNIFICANT' ? 'notification-card significant-price' : 'notification-card'}
          data-testid={`notification-${notification.id}`}
          key={notification.id}
        >
          <div className="article-card-heading">
            <strong>{notification.title}</strong>
            <span className="status-chip">{notification.readAt ? 'Letta' : 'Da leggere'}</span>
          </div>
          <p>{notification.body}</p>
          <small>{formatDate(notification.createdAt)}</small>
          {!notification.readAt && (
            <button className="secondary-button" onClick={() => void markRead(notification.id)} type="button">Segna come letta</button>
          )}
        </article>
      ))}
      {notifications.length === 0 && <div className="empty-state">Nessuna notifica per questo store.</div>}
    </section>
  )
}
