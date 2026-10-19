import { useEffect, useState } from 'react'
import { formatDuration } from './components/labels'
import { Admin } from './pages/Admin'
import { Home } from './pages/Home'
import { advanceClock, resetClock, useStore } from './state/store'

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
        <DemoControls />
      </header>
      <main className="main">{page === 'admin' ? <Admin /> : <Home />}</main>
    </div>
  )
}

export default App
