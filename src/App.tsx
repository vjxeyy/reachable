import { formatDuration } from './components/labels'
import { Home } from './pages/Home'
import { advanceClock, resetClock, useStore } from './state/store'

const SIX_HOURS = 6 * 60 * 60 * 1000

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
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span className="brand-name">REACHABLE</span>
          <span className="brand-tag">Know before you go</span>
        </a>
        <DemoControls />
      </header>
      <main className="main">
        <Home />
      </main>
    </div>
  )
}

export default App
