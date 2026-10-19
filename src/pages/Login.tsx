import { useState, type FormEvent, type ReactNode } from 'react'
import { login, logout, useStore } from '../state/store'

/** The admin's login. There is one admin and no sign-up. */
export function Login() {
  const { source, auth } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (source === 'connecting') {
    return (
      <Shell>
        <p className="muted" role="status">
          Looking for the shared server.
        </p>
      </Shell>
    )
  }

  if (source === 'local') {
    return (
      <Shell>
        <p>
          There is no shared server here, so there is nothing to sign in to. In this mode reports are saved in your own
          browser, and the Dashboard only changes those.
        </p>
        <p>
          <a className="btn" href="#/admin">
            Open the Dashboard
          </a>
        </p>
        <p className="muted small">
          The login works on the full app, where reports are shared:{' '}
          <a href="https://reachable-app.onrender.com">reachable-app.onrender.com</a>
        </p>
      </Shell>
    )
  }

  if (!auth.ready) {
    return (
      <Shell>
        <p className="muted" role="status">
          Checking the login.
        </p>
      </Shell>
    )
  }

  if (auth.user) {
    return (
      <Shell>
        <p>
          Signed in as <strong>{auth.user.email}</strong>.
        </p>
        <div className="row">
          <a className="btn" href="#/admin">
            Open the Dashboard
          </a>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              void logout()
            }}
          >
            Sign out
          </button>
        </div>
      </Shell>
    )
  }

  if (!auth.config?.configured) {
    return (
      <Shell>
        <p>Admin login is not set up on this server yet, so nobody can sign in.</p>
        <p className="muted small">The owner sets it up with the ADMIN_EMAIL and ADMIN_PASSWORD settings.</p>
      </Shell>
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const problem = await login(email, password)
    if (problem) setError(problem)
    else window.location.hash = '#/admin'
    setBusy(false)
  }

  return (
    <Shell>
      <p className="muted small">Only the admin can sign in. Everyone else can still read and report without an account.</p>
      <form className="login-form" onSubmit={onSubmit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <span className="pw-row">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="btn btn-quiet btn-small" aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn submit-btn" disabled={busy}>
          {busy ? 'Please wait' : 'Log in'}
        </button>
      </form>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="login-page">
      <section className="panel" aria-labelledby="login-heading">
        <h1 id="login-heading" className="page-title">
          Admin
        </h1>
        {children}
      </section>
    </div>
  )
}
