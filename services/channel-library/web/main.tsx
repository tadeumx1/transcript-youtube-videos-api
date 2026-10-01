import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Channel, Enrichment, Original, Video } from '../api/types'
import './style.css'

type View = 'library' | 'channels'
type Detail = { video: Video; original: Original | null; enrichment: Enrichment | null }
const labels: Record<string, string> = {
  ready: 'Ready',
  pending: 'Pending',
  transcribing: 'Transcribing',
  enriching: 'Enriching',
  retry_wait: 'Waiting to retry',
  failed: 'Failed',
  unavailable: 'Unavailable',
}
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'Not yet'
const timestamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
function App() {
  const [token, setToken] = useState(''),
    [entry, setEntry] = useState(''),
    [authError, setAuthError] = useState(''),
    [view, setView] = useState<View>('library'),
    [selected, setSelected] = useState<string | null>(null),
    [channels, setChannels] = useState<Channel[]>([]),
    [videos, setVideos] = useState<Video[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [tab, setTab] = useState('Summary'),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [channelUrl, setChannelUrl] = useState(''),
    [query, setQuery] = useState(''),
    [channelFilter, setChannelFilter] = useState(''),
    [statusFilter, setStatusFilter] = useState(''),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [mutating, setMutating] = useState(false)
  const revision = useRef(0)
  const api = useCallback(
    async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const data = await response.json()
      if (response.status === 401) {
        setToken('')
        setEntry('')
        setAuthError('Access denied. Enter your library access key.')
        setVideos([])
        setChannels([])
        setDetail(null)
        throw new Error('Access denied')
      }
      if (!response.ok) throw new Error(data.error?.message || 'This request could not complete.')
      return data
    },
    [token],
  )
  const load = useCallback(
    async (background = false) => {
      if (!token) return
      const current = ++revision.current
      if (!background) setLoading(true)
      setError('')
      try {
        if (selected) {
          const data = await api(`/videos/${selected}`)
          if (revision.current === current) setDetail(data)
        } else if (view === 'channels') {
          const data = await api('/channels')
          if (revision.current === current) setChannels(data.items)
        } else {
          const params = new URLSearchParams({
            page: String(page),
            pageSize: '20',
            ...(query ? { q: query } : {}),
            ...(channelFilter ? { channelId: channelFilter } : {}),
            ...(statusFilter ? { status: statusFilter } : {}),
          })
          const data = await api(`/videos?${params}`)
          if (revision.current === current) {
            setVideos(data.items)
            setTotal(data.total)
          }
        }
      } catch (e) {
        if (current === revision.current)
          setError(e instanceof Error ? e.message : 'Could not load your library.')
      } finally {
        if (current === revision.current) setLoading(false)
      }
    },
    [token, selected, view, page, query, channelFilter, statusFilter, api],
  )
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(true), 5000)
    return () => {
      clearInterval(timer)
      revision.current++
    }
  }, [load])
  useEffect(() => {
    if (!token) return
    let active = true
    void api('/channels')
      .then((data) => {
        if (active) setChannels(data.items)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [token, api])
  const action = async (fn: () => Promise<unknown>, message: string) => {
    setMutating(true)
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(message)
      await load(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setMutating(false)
    }
  }
  const navigate = (next: View) => {
    setView(next)
    setSelected(null)
    setDetail(null)
    setNotice('')
    setError('')
  }
  const read = (id: string) => {
    setSelected(id)
    setDetail(null)
    setTab('Summary')
    setNotice('')
  }
  const tabs = ['Summary', 'Key points', 'Corrected transcript', 'Original transcript']
  if (!token)
    return (
      <main className="access">
        <div className="wordmark">
          m<span className="brand-dot">.</span> <span>margin</span>
        </div>
        <div className="access-card">
          <p className="eyebrow">A little less watching. A little more understanding.</p>
          <h1>
            Make room for
            <br />
            what matters.
          </h1>
          <p className="intro">
            Your favorite channels, collected daily.
            <br />
            Thoughtful summaries. The full story when you want it.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setAuthError('')
              setToken(entry)
              setEntry('')
            }}
          >
            <label htmlFor="access-key">Access key</label>
            <input
              id="access-key"
              type="password"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              autoComplete="off"
              required
              placeholder="Your private library key"
            />
            <button className="primary" type="submit">
              Unlock library <span aria-hidden="true">↗</span>
            </button>
          </form>
          {authError && <p role="alert">{authError}</p>}
          <p className="small">A quiet home for ideas worth keeping.</p>
        </div>
        <div className="access-decoration" aria-hidden="true">
          <span>01</span>
          <p>
            Watch less.
            <br />
            <em>Keep more.</em>
          </p>
          <div className="decor-line" />
        </div>
      </main>
    )
  return (
    <div className="shell">
      <aside className="sidebar">
        <button type="button" className="wordmark brand-button" onClick={() => navigate('library')}>
          m<span className="brand-dot">.</span>
          <span>margin</span>
        </button>
        <p className="side-label">YOUR SPACE</p>
        <nav aria-label="Main navigation">
          <button
            type="button"
            className={view === 'library' ? 'nav active' : 'nav'}
            onClick={() => navigate('library')}
          >
            <span aria-hidden="true">▤</span> Library
          </button>
          <button
            type="button"
            className={view === 'channels' ? 'nav active' : 'nav'}
            onClick={() => navigate('channels')}
          >
            <span aria-hidden="true">◉</span> Channels
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" />
          Collected daily
          <p>
            New perspectives,
            <br />
            at your own pace.
          </p>
        </div>
        <button
          type="button"
          className="lock"
          onClick={() => {
            setToken('')
            setEntry('')
            setVideos([])
            setDetail(null)
            setChannels([])
          }}
        >
          Lock library <span aria-hidden="true">↗</span>
        </button>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>THE READING ROOM</span>
          <span>
            Notes from the channels you follow <span aria-hidden="true">↙</span>
          </span>
        </header>
        {selected ? (
          <>
            <button
              type="button"
              className="back"
              onClick={() => {
                setSelected(null)
                setDetail(null)
              }}
            >
              ← Back to library
            </button>
            {detail && (
              <>
                <div className="reader-heading">
                  <p className="eyebrow">{detail.video.channelTitle}</p>
                  <h1>{detail.video.title}</h1>
                  <div className="meta">
                    <span className={`badge ${detail.video.status}`}>
                      {labels[detail.video.status]}
                    </span>
                    <span>{date(detail.video.publishedAt)}</span>
                    <a
                      href={`https://www.youtube.com/watch?v=${detail.video.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Watch on YouTube ↗
                    </a>
                  </div>
                </div>
                <div className="tabs" role="tablist" aria-label="Reading format">
                  {tabs.map((name) => (
                    <button
                      key={name}
                      role="tab"
                      type="button"
                      id={`tab-${name.split(' ')[0]}`}
                      aria-selected={tab === name}
                      aria-controls="reading-panel"
                      onClick={() => setTab(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <article
                  className="reading"
                  id="reading-panel"
                  role="tabpanel"
                  aria-labelledby={`tab-${tab.split(' ')[0]}`}
                >
                  {tab === 'Original transcript' ? (
                    detail.original ? (
                      <>
                        <div className="reading-note">
                          Original · {detail.original.language} ·{' '}
                          {detail.original.source.replaceAll('_', ' ')} ·{' '}
                          {detail.original.timestampPrecision} timestamps
                        </div>
                        <p className="prose">{detail.original.text}</p>
                        <details open>
                          <summary>Source timestamps</summary>
                          {detail.original.segments.map((s) => (
                            <div
                              className="segment"
                              key={`${s.startSeconds}-${s.durationSeconds}-${s.text}`}
                            >
                              <a
                                href={`https://www.youtube.com/watch?v=${detail.video.id}&t=${Math.floor(s.startSeconds)}s`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {timestamp(s.startSeconds)}
                              </a>
                              <p>{s.text}</p>
                            </div>
                          ))}
                        </details>
                      </>
                    ) : (
                      <p>The original transcript is not available yet.</p>
                    )
                  ) : detail.enrichment ? (
                    <>
                      {tab === 'Summary' && (
                        <>
                          <p className="eyebrow">THE ESSENTIALS</p>
                          <h2>The idea, in a few words.</h2>
                          <p className="prose summary-text">{detail.enrichment.summary}</p>
                        </>
                      )}
                      {tab === 'Key points' && (
                        <>
                          <p className="eyebrow">WORTH REMEMBERING</p>
                          <h2>Ideas to take with you.</h2>
                          <ol className="points">
                            {detail.enrichment.keyPoints.map((point, i) => (
                              <li key={point}>
                                <span>{String(i + 1).padStart(2, '0')}</span>
                                <p>{point}</p>
                              </li>
                            ))}
                          </ol>
                        </>
                      )}
                      {tab === 'Corrected transcript' && (
                        <>
                          <p className="reading-note">
                            Edited for readability by AI. Compare with the original for accuracy.
                          </p>
                          <p className="prose">{detail.enrichment.correctedText}</p>
                        </>
                      )}
                      <footer className="reading-note">
                        Prepared with {detail.enrichment.model} ·{' '}
                        {date(detail.enrichment.completedAt)}
                      </footer>
                    </>
                  ) : (
                    <div className="waiting">
                      <h2>The story is still being prepared.</h2>
                      <p>You can read any saved original while processing continues.</p>
                    </div>
                  )}
                </article>
                {['failed', 'unavailable'].includes(detail.video.status) && (
                  <div className="retry-box">
                    <p>
                      {detail.video.failure?.message || 'This video could not be processed.'}{' '}
                      <code>{detail.video.failure?.code}</code>
                    </p>
                    <button
                      type="button"
                      disabled={mutating}
                      onClick={() =>
                        void action(
                          () => api(`/videos/${detail.video.id}/retry`, 'POST'),
                          'Processing queued.',
                        )
                      }
                    >
                      Retry processing
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        ) : view === 'channels' ? (
          <>
            <section className="page-heading">
              <p className="eyebrow">CURATE YOUR INPUT</p>
              <h1>Follow your curiosity.</h1>
              <p>Add a channel. We’ll bring the new ideas to you.</p>
            </section>
            <form
              className="add-channel"
              onSubmit={(e) => {
                e.preventDefault()
                void action(async () => {
                  await api('/channels', 'POST', { url: channelUrl })
                  setChannelUrl('')
                }, 'Channel added. The ten most recent videos are queued.')
              }}
            >
              <label htmlFor="channel-url">YouTube channel URL</label>
              <div>
                <input
                  id="channel-url"
                  type="url"
                  required
                  placeholder="https://youtube.com/@channel"
                  value={channelUrl}
                  onChange={(e) => setChannelUrl(e.target.value)}
                />
                <button className="primary" disabled={mutating} type="submit">
                  Add channel
                </button>
              </div>
              <p className="small">
                Start with the 10 latest videos, then collect new publications daily.
              </p>
            </form>
            <section className="channel-list" aria-label="Followed channels">
              {channels.length === 0 && !loading ? (
                <div className="empty">
                  <h2>No channels yet.</h2>
                  <p>Add a YouTube channel above to begin your collection.</p>
                </div>
              ) : (
                channels.map((c) => (
                  <article className="channel" key={c.id}>
                    <div className="channel-avatar" aria-hidden="true">
                      {c.title.slice(0, 1)}
                    </div>
                    <div className="channel-info">
                      <h2>{c.title}</h2>
                      <span className="badge">{c.paused ? 'Paused' : c.collectionStatus}</span>
                      <p>Last collected: {date(c.lastCollectedAt)}</p>
                      <p>Next collection: {c.paused ? 'Paused' : date(c.nextCollectionAt)}</p>
                      {c.lastError && (
                        <p className="channel-error">
                          {c.lastError.code}: {c.lastError.message}
                        </p>
                      )}
                    </div>
                    <div className="channel-actions">
                      <button
                        type="button"
                        disabled={mutating || c.paused}
                        onClick={() =>
                          void action(
                            () => api(`/channels/${c.id}/sync`, 'POST'),
                            'Collection queued.',
                          )
                        }
                      >
                        Collect now
                      </button>
                      <button
                        type="button"
                        disabled={mutating}
                        onClick={() =>
                          void action(
                            () => api(`/channels/${c.id}`, 'PATCH', { paused: !c.paused }),
                            c.paused ? 'Channel resumed.' : 'Channel paused.',
                          )
                        }
                      >
                        {c.paused ? 'Resume' : 'Pause'}
                      </button>
                    </div>
                  </article>
                ))
              )}
            </section>
          </>
        ) : (
          <>
            <section className="page-heading library-heading">
              <div>
                <p className="eyebrow">GOOD IDEAS DESERVE A SECOND LOOK</p>
                <h1>
                  Your video library<span className="brand-dot">.</span>
                </h1>
                <p>A daily collection of perspectives, ready to read.</p>
              </div>
              <div className="count">
                <strong>{String(total).padStart(2, '0')}</strong>
                <span>stories collected</span>
              </div>
            </section>
            <div className="filters">
              <div className="search">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="Search videos"
                  placeholder="Find an idea by video title…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setPage(1)
                  }}
                />
              </div>
              <select
                aria-label="Filter by channel"
                value={channelFilter}
                onChange={(e) => {
                  setChannelFilter(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">All channels</option>
                {channels.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">All statuses</option>
                {Object.entries(labels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="section-label">
              <span>THE LATEST EDITION</span>
              <span>NEWEST FIRST ↓</span>
            </div>
            {videos.length === 0 && !loading ? (
              <div className="empty">
                <span className="empty-mark" aria-hidden="true">
                  ↗
                </span>
                <h2>Your next good read starts with a channel.</h2>
                <p>
                  {query || channelFilter || statusFilter
                    ? 'No videos match these filters.'
                    : 'Follow the voices you want to make time for.'}
                </p>
                {query || channelFilter || statusFilter ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setChannelFilter('')
                      setStatusFilter('')
                      setPage(1)
                    }}
                  >
                    Clear filters
                  </button>
                ) : (
                  <button type="button" className="primary" onClick={() => navigate('channels')}>
                    Add your first channel
                  </button>
                )}
              </div>
            ) : (
              <div className="video-grid">
                {videos.map((v, i) => (
                  <article className="video-card" key={v.id}>
                    <button
                      type="button"
                      className="card-button"
                      aria-label={`Read ${v.title}`}
                      onClick={() => read(v.id)}
                    >
                      <div className={`cover tint-${i % 3}`}>
                        {v.thumbnail ? (
                          <img
                            src={v.thumbnail}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <>
                            <span className="cover-channel">{v.channelTitle}</span>
                            <span className="cover-mark" aria-hidden="true">
                              ↗
                            </span>
                          </>
                        )}
                        <span className={`badge ${v.status}`}>{labels[v.status]}</span>
                      </div>
                      <div className="card-content">
                        <p className="eyebrow">{v.channelTitle}</p>
                        <h2>{v.title}</h2>
                        <div className="card-footer">
                          <time dateTime={v.publishedAt}>
                            {new Intl.DateTimeFormat('en', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            }).format(new Date(v.publishedAt))}
                          </time>
                          <span>Read story ↗</span>
                        </div>
                      </div>
                    </button>
                  </article>
                ))}
              </div>
            )}
            <div className="pagination">
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                ← Previous
              </button>
              <span>
                Page {page} of {Math.max(1, Math.ceil(total / 20))}
              </span>
              <button
                type="button"
                disabled={page * 20 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          </>
        )}
        {loading && (
          <p className="load-state" role="status">
            Loading your reading room…
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void load()}>
              Retry loading
            </button>
          </div>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <footer className="page-footer">
          <span>MAKE SPACE FOR A NEW PERSPECTIVE.</span>
          <span>margin © {new Date().getFullYear()}</span>
        </footer>
      </main>
    </div>
  )
}
const root = document.getElementById('root')
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
