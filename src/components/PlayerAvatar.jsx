import { useState } from 'react'

/**
 * Portrait with an initials fallback. Provider photo URLs 404 regularly for
 * newly signed players, so a broken image must degrade rather than show a
 * browser placeholder. Recording *which* URL failed rather than a boolean means
 * a different player automatically gets a fresh attempt.
 */
export function PlayerAvatar({ initials, photoUrl, size = 'medium' }) {
  const [failedUrl, setFailedUrl] = useState(null)

  const showPhoto = Boolean(photoUrl) && failedUrl !== photoUrl
  const className = `avatar avatar-${size}${showPhoto ? ' has-photo' : ''}`

  return (
    <span className={className} aria-hidden="true">
      {showPhoto
        ? <img src={photoUrl} alt="" loading="lazy" onError={() => setFailedUrl(photoUrl)} />
        : initials}
    </span>
  )
}
