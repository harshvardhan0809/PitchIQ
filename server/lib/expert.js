/**
 * Expert View — a curated feed of real FPL-community writing.
 *
 * An admin configures a short list of public RSS/Atom sources in the console
 * (see settings.js `expert`); this module fetches those feeds server-side, parses
 * the items with a small dependency-free reader, and merges them into one
 * newest-first stream that links out to the original articles. Nothing is
 * authored here and nothing is user-generated, so there is no moderation surface
 * — it's aggregation of sources a human already vetted.
 *
 * Because the URLs are operator-supplied and fetched by the server, each is
 * screened for SSRF (https + public host only), fetched with a timeout and a
 * real User-Agent, and one bad feed never sinks the rest (Promise.allSettled).
 */

const FETCH_TIMEOUT_MS = 8000
const MAX_PER_SOURCE = 12
const MAX_TOTAL = 40
const EXCERPT_LEN = 220
// Feeds routinely reject the default fetch agent; present as a normal reader.
const USER_AGENT = 'OptiXI/1.0 (+https://pitch-iq-opal.vercel.app; feed reader)'

/**
 * Reject anything that isn't a plainly-public https URL, so an admin typo (or a
 * hostile source row) can't turn the server into an SSRF proxy for the metadata
 * service or an internal host.
 */
export function isSafeFeedUrl(value) {
  let url
  try {
    url = new URL(String(value))
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (host === '::1' || host === '0.0.0.0') return false
  // Block the obvious private / link-local IPv4 ranges.
  if (/^127\./.test(host)) return false
  if (/^10\./.test(host)) return false
  if (/^192\.168\./.test(host)) return false
  if (/^169\.254\./.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  return true
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", nbsp: ' ' }

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X'
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name] ?? whole
  })
}

/**
 * Collapse a chunk of feed markup into a plain-text excerpt.
 *
 * Order matters: many feeds (Reddit, WordPress) *entity-encode* their HTML, so
 * the body arrives as `&lt;table&gt;…`. We must decode entities FIRST so those
 * become real tags, then strip them — otherwise the markup shows through as
 * literal text. A second decode pass handles double-encoded entities (e.g.
 * `&amp;#39;`). The tag matcher requires a letter/`/`/`!` after `<` so a stray
 * "5 < 10" in prose isn't mistaken for a tag.
 */
function toText(raw, max = EXCERPT_LEN) {
  if (!raw) return ''
  let text = String(raw).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  text = decodeEntities(text)
  text = text
    .replace(/<!--[\s\S]*?-->/g, ' ') // comments, incl. Reddit's SC_OFF / SC_ON
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?[a-zA-Z!][^>]*>/g, ' ') // real tags only
  text = decodeEntities(text)
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`
}

/** First captured group of the first matching block, unwrapped from CDATA. */
function pick(block, regexes) {
  for (const regex of regexes) {
    const match = regex.exec(block)
    if (match && match[1] != null) {
      return match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim()
    }
  }
  return null
}

function extractLink(block) {
  // RSS: <link>https://…</link>. Atom: <link href="…" rel="alternate"/>.
  const rss = pick(block, [/<link[^>]*>([\s\S]*?)<\/link>/i])
  if (rss && /^https?:\/\//i.test(rss)) return rss
  const alternate = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(block)
    || /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i.exec(block)
  if (alternate) return alternate[1]
  const anyHref = /<link[^>]*href=["']([^"']+)["']/i.exec(block)
  return anyHref ? anyHref[1] : null
}

function toIsoDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// A YouTube video id is 11 URL-safe chars; pull it from the Atom `yt:videoId`
// element (channel feeds) or from a watch/short-link URL.
function youtubeIdFrom(block, link) {
  const tagged = pick(block, [/<yt:videoId>([\w-]{6,})<\/yt:videoId>/i])
  if (tagged) return tagged
  const fromLink = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/i.exec(link ?? '')
  return fromLink ? fromLink[1] : null
}

/** Best-effort lead image for an article: only https so it never trips CSP/mixed-content. */
function extractImage(block) {
  const attr = (re) => { const m = re.exec(block); return m ? m[1] : null }
  const candidate =
    attr(/<media:thumbnail[^>]*\burl=["']([^"']+)["']/i)
    || attr(/<media:content[^>]*\bmedium=["']image["'][^>]*\burl=["']([^"']+)["']/i)
    || attr(/<media:content[^>]*\burl=["']([^"']+)["'][^>]*\bmedium=["']image["']/i)
    || attr(/<enclosure[^>]*\btype=["']image\/[^"']*["'][^>]*\burl=["']([^"']+)["']/i)
    || attr(/<enclosure[^>]*\burl=["']([^"']+)["'][^>]*\btype=["']image\//i)
    // First <img> inside the (often entity-encoded) content/description.
    || (() => {
      const html = decodeEntities(pick(block, [
        /<content:encoded>([\s\S]*?)<\/content:encoded>/i,
        /<content[^>]*>([\s\S]*?)<\/content>/i,
        /<description>([\s\S]*?)<\/description>/i,
      ]) ?? '')
      const m = /<img[^>]*\bsrc=["']([^"']+)["']/i.exec(html)
      return m ? m[1] : null
    })()
  return candidate && /^https:\/\//i.test(candidate) ? candidate : null
}

/** Parse one feed body (RSS 2.0 or Atom) into normalised article objects. */
function parseFeed(xml, source) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi)
    ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi)
    ?? []
  const articles = []
  for (const block of blocks.slice(0, MAX_PER_SOURCE)) {
    const title = toText(pick(block, [/<title[^>]*>([\s\S]*?)<\/title>/i]), 160)
    const link = extractLink(block)
    if (!title || !link || !/^https?:\/\//i.test(link)) continue
    const publishedAt = toIsoDate(pick(block, [
      /<pubDate>([\s\S]*?)<\/pubDate>/i,
      /<published>([\s\S]*?)<\/published>/i,
      /<updated>([\s\S]*?)<\/updated>/i,
      /<dc:date>([\s\S]*?)<\/dc:date>/i,
    ]))
    const excerpt = toText(pick(block, [
      /<media:description>([\s\S]*?)<\/media:description>/i,
      /<description>([\s\S]*?)<\/description>/i,
      /<summary[^>]*>([\s\S]*?)<\/summary>/i,
      /<content[^>]*>([\s\S]*?)<\/content>/i,
    ]))
    const videoId = youtubeIdFrom(block, link)
    // YouTube's own thumbnail is a stable https URL derived from the id.
    const image = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : extractImage(block)
    articles.push({
      id: link,
      type: videoId ? 'video' : 'article',
      title,
      url: link,
      source: source.name,
      publishedAt,
      excerpt,
      image,
      videoId,
    })
  }
  return articles
}

async function fetchOneFeed(source) {
  if (!isSafeFeedUrl(source.url)) return []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    })
    if (!response.ok) return []
    const xml = await response.text()
    return parseFeed(xml, source)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch every configured source and merge into one newest-first stream. `cache`
 * (the shared TtlCache) memoises the whole merged feed for a few minutes so the
 * public route doesn't re-fetch upstream on every visit.
 */
export async function getExpertFeed({ expert, cache }) {
  const config = expert ?? {}
  const sources = (config.sources ?? []).filter((s) => s && s.url && isSafeFeedUrl(s.url))

  if (config.enabled === false) {
    return { enabled: false, generatedAt: new Date().toISOString(), sources: [], articles: [] }
  }
  if (sources.length === 0) {
    return { enabled: true, generatedAt: new Date().toISOString(), sources: [], articles: [] }
  }

  const key = `expert:${sources.map((s) => s.url).join('|')}`
  const build = async () => {
    const results = await Promise.allSettled(sources.map(fetchOneFeed))
    const seen = new Set()
    const merged = []
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      for (const article of result.value) {
        if (seen.has(article.url)) continue
        seen.add(article.url)
        merged.push(article)
      }
    }
    merged.sort((a, b) => {
      const at = a.publishedAt ? Date.parse(a.publishedAt) : 0
      const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0
      return bt - at
    })
    return {
      enabled: true,
      generatedAt: new Date().toISOString(),
      sources: sources.map((s) => s.name),
      articles: merged.slice(0, MAX_TOTAL),
    }
  }

  if (cache && typeof cache.resolve === 'function') {
    return cache.resolve(key, 10 * 60 * 1000, build)
  }
  return build()
}
