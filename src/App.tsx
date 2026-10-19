import { useEffect, useState } from 'react'
import { formatDuration } from './components/labels'
import { Admin } from './pages/Admin'
import { Home } from './pages/Home'
import { advanceClock, dismissToast, resetClock, startSync, useStore, type Source } from './state/store'

const SIX_HOURS = 6 * 60 * 60 * 1000

type Page = 'map' | 'admin'

function pageFromHash(): Page {
  return window.location.hash.startsWith('#/admin') ? 'admin' : 'map'
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

function DemoControls() {
  const { timeOffsetMs } = useStore()
  return (
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
    </div>
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
            Map
          </a>
          <a href="#/admin" aria-current={page === 'admin' ? 'page' : undefined}>
            Admin
          </a>
        </nav>
        <SourceBadge />
        <DemoControls />
      </header>
      <main className="main">{page === 'admin' ? <Admin /> : <Home />}</main>
      <Toast />
    </div>
  )
}

export default App
