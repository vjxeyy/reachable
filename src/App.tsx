import { useEffect, useState } from 'react'
import { FlagIcon, GridIcon, MapIcon, PersonIcon } from './components/icons'
import { formatDuration } from './components/labels'
import { Admin } from './pages/Admin'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Report } from './pages/Report'
import { advanceClock, dismissToast, logout, resetClock, resetDemo, startSync, useStore, type Source } from './state/store'

const SIX_HOURS = 6 * 60 * 60 * 1000

type Page = 'map' | 'report' | 'admin' | 'login'

function pageFromHash(): Page {
  const hash = window.location.hash
  if (hash.startsWith('#/admin')) return 'admin'
  if (hash.startsWith('#/report')) return 'report'
  if (hash.startsWith('#/login')) return 'login'
  return 'map'
}

function usePage(): Page {
  const [page, setPage] = useState(pageFromHash)
  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return page
}

const SOURCE_TEXT: Record<Source, { label: string; title: string }> = {
  connecting: { label: 'Connecting…', title: 'Looking for the shared server' },
  api: { label: 'Shared server', title: 'Reports are stored on the server and shared with everyone' },
  local: { label: 'This browser only', title: 'No server reachable. Reports are saved in this browser and it retries every 15 s.' },
}

function SourceBadge() {
  const { source } = useStore()
  return (
    <span className={`source source-${source}`} title={SOURCE_TEXT[source].title}>
      <span className="source-dot" aria-hidden="true" /> {SOURCE_TEXT[source].label}
    </span>
  )
}

/** Top right: Admin opens the login page; once signed in it shows who, with Sign out. */
function AdminButton({ page }: { page: Page }) {
  const { source, auth } = useStore()
  if (source === 'api' && auth.user) {
    return (
      <span className="admin-session">
        <span className="admin-chip" title={auth.user.email}>
          {auth.user.email}
        </span>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => void logout()}>
          Sign out
        </button>
      </span>
    )
  }
  return (
    <a className="admin-btn" href="#/login" aria-current={page === 'login' ? 'page' : undefined}>
      <PersonIcon /> Admin
    </a>
  )
}

function Toast() {
  const { toast } = useStore()
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => dismissToast(toast.id), 4500)
    return () => clearTimeout(timer)
  }, [toast])
  return (
    <div className="toast-region" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  )
}

/** Tools for whoever is presenting: they are not part of using the app. */
function DemoFooter() {
  const { timeOffsetMs } = useStore()
  return (
    <footer className="demo-footer">
      <h2>Demo tools</h2>
      <p className="muted small">
        Only for presenting. Reports expire after a set time, so jump the clock ahead to show one expiring, or reset
        to bring back the example reports.
      </p>
      <div className="demo-controls" aria-label="Demo controls">
      <span className={`clock${timeOffsetMs > 0 ? ' clock-ahead' : ''}`} aria-live="polite">
        {timeOffsetMs > 0 ? `Demo clock: now + ${formatDuration(timeOffsetMs)}` : 'Clock: now'}
      </span>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => advanceClock(SIX_HOURS)}>
        +6 hours
      </button>
      {timeOffsetMs > 0 && (
        <button type="button" className="btn btn-quiet btn-small" onClick={resetClock}>
          Back to now
        </button>
      )}
      <button
        type="button"
        className="btn btn-quiet btn-small"
        onClick={() => {
          if (window.confirm('Reset the demo? All reports are removed and the example reports come back.')) void resetDemo()
        }}
      >
        Reset demo
      </button>
      </div>
    </footer>
  )
}

function App() {
  const page = usePage()
  useEffect(() => startSync(), [])
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span className="brand-name">REACHABLE</span>
          <span className="brand-tag">Know before you go</span>
        </a>
        <nav className="nav" aria-label="Pages">
          <a href="#/" aria-current={page === 'map' ? 'page' : undefined}>
            <MapIcon /> Campus map
          </a>
          <a href="#/report" aria-current={page === 'report' ? 'page' : undefined}>
            <FlagIcon /> Report obstacle
          </a>
          <a href="#/admin" aria-current={page === 'admin' ? 'page' : undefined}>
            <GridIcon /> Dashboard
          </a>
        </nav>
        <div className="header-tools">
          <SourceBadge />
          <AdminButton page={page} />
        </div>
      </header>
      <main className="main">
        {page === 'admin' ? <Admin /> : page === 'login' ? <Login /> : page === 'report' ? <Report /> : <Home />}
      </main>
      <DemoFooter />
      <Toast />
    </div>
  )
}

export default App
