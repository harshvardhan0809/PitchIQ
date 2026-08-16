import { useAsync } from '../../hooks/useAsync'
import { fetchExpert } from '../../services/footballApi'
import '../../styles/intel.css'

/**
 * Expert View: a curated feed of real FPL-community writing, merged from the
 * admin-configured RSS/Atom sources and linking out to the original articles.
 * A free, read-only aggregation — no login, no user-generated content.
 */
function timeAgo(iso) {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// A stable per-source accent so each outlet's chip reads consistently.
function sourceHue(name) {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 360
  return hash
}

function ArticleCard({ article }) {
  const hue = sourceHue(article.source)
  return (
    <li className="exp-card">
      <a className="exp-link" href={article.url} target="_blank" rel="noopener noreferrer">
        <div className="exp-meta">
          <span className="exp-source" style={{ '--exp-hue': hue }}>{article.source}</span>
          {article.publishedAt && <span className="exp-time">{timeAgo(article.publishedAt)}</span>}
        </div>
        <h3 className="exp-title">{article.title}</h3>
        {article.excerpt && <p className="exp-excerpt">{article.excerpt}</p>}
        <span className="exp-cta">Read on {article.source} ↗</span>
      </a>
    </li>
  )
}

function Skeleton() {
  return (
    <div className="intel-skeleton" aria-hidden="true">
      <div className="sk hero" />
      {[0, 1, 2].map((index) => <div className="sk row" key={index} />)}
    </div>
  )
}

export function ExpertView() {
  const { status, data, error, reload } = useAsync(fetchExpert, [])
  const articles = data?.articles ?? []

  return (
    <div className="intel exp">
      <header className="intel-head">
        <div>
          <p className="intel-eyebrow">Expert View</p>
          <h1 className="intel-title">Reads from the community</h1>
          <p className="intel-sub">
            The latest FPL writing from trusted community sources, gathered in one place. Tap any piece to read the
            full article at its source.
          </p>
          {data?.sources?.length > 0 && (
            <p className="intel-gw">Sourced from <b>{data.sources.join(' · ')}</b></p>
          )}
        </div>
        {status === 'ready' && (
          <button type="button" className="sq-connected-reload" onClick={reload}>Refresh</button>
        )}
      </header>

      {status === 'loading' && <Skeleton />}

      {status === 'error' && (
        <div className="intel-error">
          <p>{error?.message ?? 'Could not load the expert feed.'}</p>
          <button type="button" onClick={reload}>Try again</button>
        </div>
      )}

      {status === 'ready' && (
        articles.length === 0 ? (
          <div className="sq-connect-prompt">
            <span className="sq-connect-mark" aria-hidden="true">📰</span>
            <h3>No articles yet</h3>
            <p>
              {data?.enabled === false
                ? 'The expert feed is currently switched off.'
                : 'No community sources are set up yet, or they returned nothing. An admin can add feeds in the console.'}
            </p>
          </div>
        ) : (
          <ul className="exp-grid">
            {articles.map((article) => <ArticleCard key={article.id} article={article} />)}
          </ul>
        )
      )}

      <p className="exp-foot">Articles are published by their respective authors. PitchIQ links to them for convenience and does not host or endorse the content.</p>
    </div>
  )
}
