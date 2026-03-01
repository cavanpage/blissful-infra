import { useState, useEffect, useCallback } from 'react'

// ------------------------------------------------------------------ //
// Types                                                                //
// ------------------------------------------------------------------ //

interface ContentItem {
  id: string
  title: string
  genres: string[]
  tags: string[]
  year: number
  rating: number
}

interface Recommendation {
  id: string
  title: string
  genres: string[]
  score: number
  source: string
  year?: number
  catalog_rating?: number
}

type Tab = 'browse' | 'for-you' | 'trending'

// ------------------------------------------------------------------ //
// API helpers (proxied via /ai → localhost:8090)                      //
// ------------------------------------------------------------------ //

async function fetchCatalog(): Promise<ContentItem[]> {
  const res = await fetch('/ai/catalog')
  if (!res.ok) throw new Error('Catalog unavailable')
  const data = await res.json()
  return data.items
}

async function fetchRecommendations(userId: string): Promise<Recommendation[]> {
  const res = await fetch(`/ai/recommendations/${encodeURIComponent(userId)}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.recommendations ?? []
}

async function fetchTrending(): Promise<Recommendation[]> {
  const res = await fetch('/ai/trending')
  if (!res.ok) return []
  const data = await res.json()
  return data.trending ?? []
}

async function postEvent(userId: string, itemId: string, eventType: string, value = 1.0) {
  await fetch('/ai/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, item_id: itemId, event_type: eventType, value }),
  })
}

// ------------------------------------------------------------------ //
// Small components                                                     //
// ------------------------------------------------------------------ //

function GenrePill({ genre }: { genre: string }) {
  const colors: Record<string, string> = {
    'sci-fi': '#6366f1', thriller: '#dc2626', drama: '#0891b2',
    action: '#ea580c', horror: '#7c3aed', comedy: '#16a34a',
    documentary: '#0d9488', romance: '#db2777', animation: '#d97706',
    crime: '#b45309', noir: '#374151', adventure: '#0284c7',
    sport: '#15803d', music: '#9333ea', biography: '#64748b',
    war: '#b91c1c', fantasy: '#7c3aed', historical: '#92400e',
    'superhero': '#1d4ed8',
  }
  const bg = colors[genre] ?? '#4b5563'
  return (
    <span style={{ background: bg, color: '#fff', fontSize: 11, padding: '2px 7px', borderRadius: 99, fontWeight: 600 }}>
      {genre}
    </span>
  )
}

function SourceBadge({ source }: { source: string }) {
  const label: Record<string, string> = {
    hybrid: 'Hybrid', collaborative: 'Collab', content: 'Content', trending: 'Trending',
  }
  const color: Record<string, string> = {
    hybrid: '#6366f1', collaborative: '#0891b2', content: '#16a34a', trending: '#d97706',
  }
  return (
    <span style={{ fontSize: 10, color: color[source] ?? '#6b7280', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
      {label[source] ?? source}
    </span>
  )
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div style={{ height: 3, background: '#1f2937', borderRadius: 99, width: '100%', marginTop: 4 }}>
      <div style={{ height: 3, background: '#6366f1', borderRadius: 99, width: `${Math.round(score * 100)}%`, transition: 'width 0.4s ease' }} />
    </div>
  )
}

// ------------------------------------------------------------------ //
// Content card                                                         //
// ------------------------------------------------------------------ //

function ContentCard({
  item, userId, onWatch, watched,
}: {
  item: ContentItem | Recommendation
  userId: string
  onWatch: (id: string) => void
  watched: boolean
}) {
  const score = 'score' in item ? item.score : undefined
  const source = 'source' in item ? item.source : undefined
  const rating = 'catalog_rating' in item ? item.catalog_rating : ('rating' in item ? item.rating : undefined)

  return (
    <div style={{
      background: '#111827', border: '1px solid #1f2937', borderRadius: 10,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8,
      transition: 'border-color 0.2s', cursor: 'default',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#374151')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#1f2937')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ color: '#f9fafb', fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{item.title}</span>
        {rating !== undefined && (
          <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>★ {Number(rating).toFixed(1)}</span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {item.genres.slice(0, 3).map(g => <GenrePill key={g} genre={g} />)}
      </div>

      {'year' in item && item.year && (
        <span style={{ color: '#6b7280', fontSize: 12 }}>{item.year}</span>
      )}

      {score !== undefined && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {source && <SourceBadge source={source} />}
            <span style={{ color: '#6b7280', fontSize: 11 }}>{Math.round(score * 100)}% match</span>
          </div>
          <ScoreBar score={score} />
        </div>
      )}

      <button
        onClick={() => { postEvent(userId, item.id, 'view_complete', 1.0); onWatch(item.id) }}
        style={{
          marginTop: 4, padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: watched ? '#1f2937' : '#6366f1', color: watched ? '#6b7280' : '#fff',
          fontSize: 12, fontWeight: 600, transition: 'background 0.2s',
        }}
      >
        {watched ? '✓ Watched' : '▶ Watch'}
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Pages                                                                //
// ------------------------------------------------------------------ //

function BrowsePage({ userId, watched, onWatch }: { userId: string; watched: Set<string>; onWatch: (id: string) => void }) {
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetchCatalog().then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  }, [])

  const filtered = filter
    ? items.filter(i => i.genres.includes(filter) || i.tags.includes(filter))
    : items

  const genres = [...new Set(items.flatMap(i => i.genres))].sort()

  if (loading) return <div style={{ color: '#6b7280', padding: 32, textAlign: 'center' }}>Loading catalog...</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button onClick={() => setFilter('')} style={filterBtnStyle(filter === '')}>All</button>
        {genres.map(g => (
          <button key={g} onClick={() => setFilter(g === filter ? '' : g)} style={filterBtnStyle(filter === g)}>
            {g}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {filtered.map(item => (
          <ContentCard key={item.id} item={item} userId={userId} onWatch={onWatch} watched={watched.has(item.id)} />
        ))}
      </div>
    </div>
  )
}

function ForYouPage({ userId, watched, onWatch }: { userId: string; watched: Set<string>; onWatch: (id: string) => void }) {
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<{ model_version?: string; from_cache?: boolean } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/ai/recommendations/${encodeURIComponent(userId)}`)
      .then(r => r.json())
      .then(d => { setRecs(d.recommendations ?? []); setMeta({ model_version: d.model_version, from_cache: d.from_cache }) })
      .catch(() => setRecs([]))
      .finally(() => setLoading(false))
  }, [userId])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ color: '#6b7280', padding: 32, textAlign: 'center' }}>Fetching recommendations for {userId}...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ color: '#6b7280', fontSize: 13 }}>
          {recs.length === 0
            ? `Watch something in Browse to train your recommendations`
            : `${recs.length} picks for ${userId}`}
          {meta && <span style={{ marginLeft: 12, color: '#374151' }}>model v{meta.model_version} {meta.from_cache ? '· cached' : '· live'}</span>}
        </div>
        <button onClick={load} style={{ ...filterBtnStyle(false), fontSize: 12 }}>↻ Refresh</button>
      </div>
      {recs.length === 0 ? (
        <div style={{ color: '#4b5563', textAlign: 'center', padding: 48, border: '1px dashed #1f2937', borderRadius: 10 }}>
          No recommendations yet — watch a few titles in Browse first
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {recs.map(r => (
            <ContentCard key={r.id} item={r} userId={userId} onWatch={onWatch} watched={watched.has(r.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function TrendingPage({ userId, watched, onWatch }: { userId: string; watched: Set<string>; onWatch: (id: string) => void }) {
  const [items, setItems] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTrending().then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ color: '#6b7280', padding: 32, textAlign: 'center' }}>Loading trending...</div>

  return (
    <div>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        Most-watched content across all users
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {items.map(item => (
          <ContentCard key={item.id} item={item} userId={userId} onWatch={onWatch} watched={watched.has(item.id)} />
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Helpers                                                              //
// ------------------------------------------------------------------ //

function filterBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px', borderRadius: 99, border: '1px solid',
    borderColor: active ? '#6366f1' : '#1f2937',
    background: active ? '#6366f1' : 'transparent',
    color: active ? '#fff' : '#9ca3af', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  }
}

// ------------------------------------------------------------------ //
// App shell                                                            //
// ------------------------------------------------------------------ //

export default function App() {
  const [tab, setTab] = useState<Tab>('browse')
  const [userId, setUserId] = useState('user1')
  const [editingUser, setEditingUser] = useState(false)
  const [watched, setWatched] = useState<Set<string>>(new Set())

  const onWatch = useCallback((id: string) => {
    setWatched(prev => new Set([...prev, id]))
  }, [])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'browse', label: 'Browse' },
    { id: 'for-you', label: 'For You' },
    { id: 'trending', label: 'Trending' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#030712', color: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid #111827', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 24 }}>
        <span style={{ fontWeight: 800, fontSize: 18, color: '#6366f1', letterSpacing: -0.5 }}>StreamAI</span>

        <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: tab === t.id ? '#111827' : 'transparent',
                color: tab === t.id ? '#f9fafb' : '#6b7280',
                fontWeight: tab === t.id ? 700 : 400, fontSize: 14,
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* User switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#6b7280', fontSize: 13 }}>Viewing as</span>
          {editingUser ? (
            <input
              autoFocus
              value={userId}
              onChange={e => setUserId(e.target.value)}
              onBlur={() => setEditingUser(false)}
              onKeyDown={e => e.key === 'Enter' && setEditingUser(false)}
              style={{
                background: '#111827', border: '1px solid #374151', borderRadius: 6,
                color: '#f9fafb', padding: '4px 10px', fontSize: 13, width: 110,
              }}
            />
          ) : (
            <button
              onClick={() => setEditingUser(true)}
              style={{
                background: '#111827', border: '1px solid #1f2937', borderRadius: 6,
                color: '#a5b4fc', padding: '4px 10px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
              }}
            >
              {userId} ✎
            </button>
          )}
          {watched.size > 0 && (
            <span style={{ color: '#4b5563', fontSize: 12 }}>{watched.size} watched</span>
          )}
        </div>
      </header>

      {/* Page content */}
      <main style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 20, color: '#f9fafb' }}>
          {tab === 'browse' && 'Browse'}
          {tab === 'for-you' && `Recommended for ${userId}`}
          {tab === 'trending' && 'Trending Now'}
        </h1>

        {tab === 'browse' && <BrowsePage userId={userId} watched={watched} onWatch={onWatch} />}
        {tab === 'for-you' && <ForYouPage userId={userId} watched={watched} onWatch={onWatch} />}
        {tab === 'trending' && <TrendingPage userId={userId} watched={watched} onWatch={onWatch} />}
      </main>
    </div>
  )
}
