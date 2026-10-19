import { useState, type FormEvent, type ReactNode } from 'react'
import { login, logout, signup, useStore } from '../state/store'

type Mode = 'login' | 'signup'

/** Admin login and sign-up. Sign-ups wait for the owner's approval. */
export function Login() {
  const { source, auth } = useStore()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

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
    const { email: who, role } = auth.user
    return (
      <Shell>
        <p>
          Signed in as <strong>{who}</strong>
          {role === 'owner' ? ' (owner)' : role === 'pending' ? ' (waiting for approval)' : ' (admin)'}.
        </p>
        {role === 'pending' && (
          <p className="muted">The owner has to approve your account before you can use the Dashboard.</p>
        )}
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

  const { config } = auth
  if (!config?.configured) {
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
    if (mode === 'login') {
      const problem = await login(email, password)
      if (problem) setError(problem)
      else window.location.hash = '#/admin'
    } else {
      const problem = await signup(email, password)
      if (problem) setError(problem)
      else {
        setSent(true)
        setMode('login')
        setPassword('')
      }
    }
    setBusy(false)
  }

  return (
    <Shell>
      {config.signupOpen && (
        <div className="toggle-row" role="group" aria-label="Log in or sign up">
          <button type="button" className={`btn btn-small ${mode === 'login' ? '' : 'btn-quiet'}`} aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(null) }}>
            Log in
          </button>
          <button type="button" className={`btn btn-small ${mode === 'signup' ? '' : 'btn-quiet'}`} aria-pressed={mode === 'signup'} onClick={() => { setMode('signup'); setError(null); setSent(false) }}>
            Sign up
          </button>
        </div>
      )}

      {mode === 'signup' && (
        <p className="muted small">An admin has to approve your account before you can use the Dashboard.</p>
      )}
      {sent && (
        <p className="notice" role="status">
          Request sent. You can sign in once an admin approves it.
        </p>
      )}

      <form className="login-form" onSubmit={onSubmit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password{mode === 'signup' ? ' (at least 10 characters)' : ''}</span>
          <span className="pw-row">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signup' ? 10 : undefined}
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
          {busy ? 'Please wait' : mode === 'login' ? 'Log in' : 'Request an account'}
        </button>
      </form>

      {config.demo && (
        <div className="demo-login">
          <h2>Demo account for judges</h2>
          <p className="muted small">
            This is a made-up login for the fictional campus, shown here on purpose. It can verify and resolve demo
            reports, but it cannot approve people or reset the demo.
          </p>
          <dl>
            <dt>Email</dt>
            <dd>{config.demo.email}</dd>
            <dt>Password</dt>
            <dd>{config.demo.password}</dd>
          </dl>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => {
              setMode('login')
              setEmail(config.demo?.email ?? '')
              setPassword(config.demo?.password ?? '')
              setError(null)
              setSent(false)
            }}
          >
            Fill in the demo login
          </button>
        </div>
      )}
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
