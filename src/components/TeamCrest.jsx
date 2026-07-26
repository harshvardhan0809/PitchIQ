import { useState } from 'react'

export function TeamCrest({ src, name, size = 22 }) {
  // Track the failed URL, not a flag, so a new crest gets its own attempt.
  const [failedSrc, setFailedSrc] = useState(null)

  if (!src || failedSrc === src) {
    return <span className="crest crest-fallback" style={{ width: size, height: size }} aria-hidden="true" />
  }

  return (
    <img
      className="crest"
      style={{ width: size, height: size }}
      src={src}
      alt={name ? `${name} crest` : ''}
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  )
}
