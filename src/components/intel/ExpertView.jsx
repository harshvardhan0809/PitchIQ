import { useState } from 'react'

import { useAsync } from '../../hooks/useAsync'
import { fetchExpert } from '../../services/footballApi'
import '../../styles/intel.css'

/**
 * Expert View: a curated feed of real FPL-community writing and video, merged
 * from the admin-configured RSS/Atom sources. Article cards link out; YouTube
 * cards play a muted preview on hover and open the full video on click. A free,
 * read-only aggregation — no login, no user-generated content.
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

const isFresh = (iso) => iso && (Date.now() - Date.parse(iso)) < 3 * 3600 * 1000

// A stable per-source accent so each outlet's chip reads consistently.
function sourceHue(name) {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 360
  return hash
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function Meta({ article }) {
  const hue = sourceHue(article.source)
  return (
    <div className="exp-meta">
      <span className="exp-source" style={{ '--exp-hue': hue }}>{article.source}</span>
      <span className="exp-meta-right">
        {isFresh(article.publishedAt) && <span className="exp-fresh">New</span>}
        {article.publishedAt && <span className="exp-time">{timeAgo(article.publishedAt)}</span>}
      </span>
    </div>
  )
}

// The media area. Video → muted hover preview + play badge; article image →
// static. A cover link sits on top so a click always opens the source, and an
// onError drop lets a dead image fall back to a text-only card.
function Media({ article, imgError, onImgError }) {
  const [playing, setPlaying] = useState(false)
  const isVideo = article.type === 'video' && article.videoId
  const showImage = article.image && !imgError

  if (!isVideo && !showImage) return null

  const enter = () => { if (isVideo && !prefersReducedMotion()) setPlaying(true) }
  const leave = () => setPlaying(false)

  return (
    <div
      className={`exp-media ${isVideo ? 'is-video' : ''}`}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {isVideo && playing ? (
        <iframe
          className="exp-embed"
          src={`https://www.youtube-nocookie.com/embed/${article.videoId}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${article.videoId}`}
          title={article.title}
          loading="lazy"
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <img className="exp-thumb" src={article.image} alt="" loading="lazy" onError={onImgError} />
      )}
      {isVideo && (
        <>
          <span className="exp-play" aria-hidden="true"><span>▶</span></span>
          <span className="exp-badge-video">Video</span>
        </>
      )}
      <a
        className="exp-cover"
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={article.title}
      />
    </div>
  )
}

function Card({ article }) {
  const [imgError, setImgError] = useState(false)
  const hue = sourceHue(article.source)
  const hasMedia = (article.type === 'video' && article.videoId) || (article.image && !imgError)
  return (
    <li className={`exp-card ${hasMedia ? 'has-media' : 'text-only'}`} style={{ '--exp-hue': hue }}>
      <Media article={article} imgError={imgError} onImgError={() => setImgError(true)} />
      <div className="exp-body">
        <Meta article={article} />
        <a className="exp-titlelink" href={article.url} target="_blank" rel="noopener noreferrer">
          <h3 className="exp-title">{article.title}</h3>
        </a>
        {article.excerpt && <p className="exp-excerpt">{article.excerpt}</p>}
        <a className="exp-cta" href={article.url} target="_blank" rel="noopener noreferrer">
          {article.type === 'video' ? `Watch on ${article.source}` : `Read on ${article.source}`} ↗
        </a>
      </div>
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
          <h1 className="intel-title">Reads &amp; watches from the community</h1>
          <p className="intel-sub">
            The latest FPL writing and video from trusted community sources, gathered in one place. Hover a clip to
            preview it; tap any card to open it at the source.
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
            {articles.map((article) => <Card key={article.id} article={article} />)}
          </ul>
        )
      )}

      <p className="exp-foot">Articles and videos are published by their respective authors. PitchIQ links to them for convenience and does not host or endorse the content.</p>
    </div>
  )
}
