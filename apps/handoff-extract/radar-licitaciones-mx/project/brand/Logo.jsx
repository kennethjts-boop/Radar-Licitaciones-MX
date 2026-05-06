// Radar Licitaciones MX — Logomark + wordmark
// Animated radar sweep with concentric rings.

function RadarLogo({ size = 36, animated = true, label = true, mono = false }) {
  const id = React.useId().replace(/:/g, '');
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, lineHeight: 1 }}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id={`g-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1A1240" />
            <stop offset="60%" stopColor="#0B0E18" />
            <stop offset="100%" stopColor="#06070C" />
          </radialGradient>
          <linearGradient id={`s-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7C3AED" stopOpacity="0" />
            <stop offset="60%" stopColor="#7C3AED" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#22D3EE" stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* Outer ring with subtle shadow */}
        <circle cx="32" cy="32" r="30" fill={`url(#g-${id})`} stroke="rgba(124,58,237,0.45)" strokeWidth="1" />
        {/* Concentric rings */}
        <circle cx="32" cy="32" r="22" fill="none" stroke="rgba(124,58,237,0.25)" strokeWidth="1" />
        <circle cx="32" cy="32" r="13" fill="none" stroke="rgba(34,211,238,0.30)" strokeWidth="1" />
        {/* Crosshair */}
        <line x1="32" y1="6" x2="32" y2="58" stroke="rgba(255,255,255,0.10)" strokeWidth="0.75" />
        <line x1="6" y1="32" x2="58" y2="32" stroke="rgba(255,255,255,0.10)" strokeWidth="0.75" />
        {/* Sweep wedge */}
        <g style={{ transformOrigin: '32px 32px', animation: animated ? 'rl-radar-sweep 3.6s linear infinite' : 'none' }}>
          <path d="M32 32 L62 32 A30 30 0 0 0 51.21 8.79 Z" fill={`url(#s-${id})`} opacity="0.85" />
        </g>
        {/* Blips */}
        <circle cx="44" cy="20" r="1.6" fill="#10F2A8" style={{ filter: 'drop-shadow(0 0 4px #10F2A8)', animation: animated ? 'rl-pulse 1.8s ease-in-out infinite' : 'none' }} />
        <circle cx="20" cy="40" r="1.2" fill="#22D3EE" style={{ filter: 'drop-shadow(0 0 4px #22D3EE)', animation: animated ? 'rl-pulse 2.4s ease-in-out infinite 0.6s' : 'none' }} />
        <circle cx="40" cy="44" r="1" fill="#D946EF" style={{ filter: 'drop-shadow(0 0 4px #D946EF)', animation: animated ? 'rl-pulse 2.0s ease-in-out infinite 1.1s' : 'none' }} />
        {/* Center dot */}
        <circle cx="32" cy="32" r="2" fill="#F5F3FF" />
      </svg>
      {label && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: mono ? 14 : 16,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'var(--text-1)',
          }}>
            Radar<span style={{ color: 'var(--violet-400)' }}>·</span>Licitaciones
          </div>
          <div className="rl-mono rl-caps" style={{
            fontSize: 9,
            color: 'var(--text-3)',
            letterSpacing: '0.18em',
          }}>
            MX · Intel Pública
          </div>
        </div>
      )}
    </div>
  );
}

window.RadarLogo = RadarLogo;
