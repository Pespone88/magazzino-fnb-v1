import { type FormEvent, useState } from 'react'

import { useAuth } from './AuthProvider'

export function LoginScreen() {
  const { signIn, requestFirstAccess } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setNotice(null)

    try {
      await signIn(email, password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Accesso non riuscito')
    } finally {
      setSubmitting(false)
    }
  }


  async function handleFirstAccess() {
    setSubmitting(true)
    setError(null)
    setNotice(null)

    try {
      await requestFirstAccess(email)
      setNotice('Link di accesso inviato. Controlla la tua email e aprilo da questo dispositivo.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invio link non riuscito')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="brand-block auth-brand">
          <span className="brand-mark">M</span>
          <div><strong>Magazzini F&amp;B</strong><small>Accesso riservato</small></div>
        </div>

        <span className="eyebrow">ACCOUNT</span>
        <h1 id="login-title">Accedi</h1>
        <p>Usa l’account assegnato per entrare nel magazzino del tuo store.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          {notice ? <div className="auth-notice" role="status">{notice}</div> : null}

          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? 'Accesso…' : 'Accedi'}
          </button>
          <button className="secondary-button" disabled={submitting} onClick={() => void handleFirstAccess()} type="button">
            Primo accesso / invia link
          </button>
        </form>
      </section>
    </main>
  )
}
