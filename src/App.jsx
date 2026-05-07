import React, { useEffect, useMemo, useState } from 'react'

const CATEGORIES = [
  'All',
  'Motor',
  'Home',
  'Life & Health',
  'Business',
  'Rural',
  'Student',
  'Trade',
]

function timeAgo(iso) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

export default function App() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [source, setSource] = useState('All')
  const [window, setWindow] = useState('7d')
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/news')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load')
      setItems(data.items || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const sources = useMemo(() => {
    const s = new Set(items.map(i => i.source).filter(Boolean))
    return ['All', ...Array.from(s).sort()]
  }, [items])

  const filtered = useMemo(() => {
    const now = Date.now()
    const within = (iso) => {
      if (window === 'All') return true
      const ms = now - new Date(iso).getTime()
      if (window === '24h') return ms <= 24*3600*1000
      if (window === '7d') return ms <= 7*24*3600*1000
      if (window === '30d') return ms <= 30*24*3600*1000
      return true
    }

    return items
      .filter(i => i.publishedAt && within(i.publishedAt))
      .filter(i => category === 'All' ? true : i.category === category)
      .filter(i => source === 'All' ? true : i.source === source)
      .filter(i => {
        if (!query.trim()) return true
        const s = `${i.title} ${i.summary} ${i.source} ${i.category}`.toLowerCase()
        return s.includes(query.toLowerCase())
      })
  }, [items, window, category, source, query])

  return (
    <div className="container">
      <div className="header">
        <h1 className="h1">Market insights dashboard</h1>
        <p className="sub">Latest insurance and related industry updates, organised by category and ordered by publish date.</p>

        <div className="controls">
          <input className="input" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search headlines, topics, sources…" />

          <select className="select" value={source} onChange={e=>setSource(e.target.value)}>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select className="select" value={window} onChange={e=>setWindow(e.target.value)}>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="All">All time</option>
          </select>

          <button className="button" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        <div className="tabs">
          {CATEGORIES.map(c => (
            <button
              key={c}
              className={`tab ${category === c ? 'active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="metaRow">
          <div>{error ? `Error: ${error}` : `${filtered.length} articles`}</div>
          <div style={{color: 'var(--howden-petrol)', fontWeight: 600}}>Newest first</div>
        </div>
      </div>

      <div className="list">
        {filtered.map(a => (
          <div className="card" key={a.id}>
            <div className="badges">
              <span className="badge">{a.category || 'Other'}</span>
              <span>{a.source}</span>
              <span>•</span>
              <span>{new Date(a.publishedAt).toLocaleString()}</span>
              <span>({timeAgo(a.publishedAt)})</span>
            </div>
            <h3 className="title">{a.title}</h3>
            {a.summary ? <p className="summary">{a.summary}</p> : null}
            <div className="actions">
              <a className="linkBtn" href={a.url} target="_blank" rel="noreferrer">Read source ↗</a>
            </div>
          </div>
        ))}

        {!loading && !error && filtered.length === 0 ? (
          <div className="card">
            <div className="summary">No results. Try a different category, source, or time window.</div>
          </div>
        ) : null}
      </div>

      <div className="footer">
        Tip: This dashboard shows headlines + summaries and links back to the original publisher.
      </div>
    </div>
  )
}
