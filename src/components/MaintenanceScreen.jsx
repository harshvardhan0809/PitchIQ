import '../styles/maintenance.css'

/**
 * Full-screen maintenance lockout, shown to everyone except admins while
 * maintenance mode is on (see the gate in App). It's a courtesy notice, not the
 * security boundary — the server fails every data endpoint closed (503) during
 * maintenance, so there's nothing to reach even if this screen is skipped.
 *
 * The headline runs a continuous chromatic-glitch effect (pure CSS via the two
 * duplicated `data-text` layers); reduced-motion viewers get a clean still.
 */
export function MaintenanceScreen({ message }) {
  const title = 'MAINTENANCE'

  return (
    <div className="mnt" role="alert" aria-live="polite">
      <div className="mnt-grid" aria-hidden="true" />
      <div className="mnt-scan" aria-hidden="true" />
      <div className="mnt-panel">
        <div className="mnt-brand">
          <img className="mnt-mark" src="/OptiXI.png" alt="OptiXI" width="40" height="40" />
          <span className="mnt-wordmark">OptiXI</span>
        </div>

        <p className="mnt-eyebrow">
          <span className="mnt-pulse" aria-hidden="true" /> System status
        </p>

        <h1 className="mnt-glitch" data-text={title} aria-label="Maintenance in progress">
          {title}
        </h1>
        <p className="mnt-subtitle">in progress</p>

        <p className="mnt-message">
          {message || 'OptiXI is down for scheduled maintenance. We’re making things better and will be back shortly.'}
        </p>

        <div className="mnt-foot">
          <span className="mnt-ticker">please stand by · reconnecting shortly</span>
        </div>
      </div>
    </div>
  )
}
