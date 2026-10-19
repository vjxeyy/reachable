import { Home } from './pages/Home'

function App() {
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span className="brand-name">REACHABLE</span>
          <span className="brand-tag">Know before you go</span>
        </a>
      </header>
      <main className="main">
        <Home />
      </main>
    </div>
  )
}

export default App
