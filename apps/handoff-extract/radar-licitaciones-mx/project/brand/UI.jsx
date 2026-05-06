// Shared UI primitives for Radar Licitaciones MX

// === StatusPill ===
function StatusPill({ status, children }) {
  const map = {
    activa: { color: 'var(--status-active)', bg: 'var(--status-active-bg)', label: 'ACTIVA', dot: true, glow: true },
    cerrando: { color: 'var(--status-closing)', bg: 'var(--status-closing-bg)', label: 'CIERRA 24H', dot: true },
    nueva: { color: 'var(--status-new)', bg: 'var(--status-new-bg)', label: 'NUEVA', dot: false },
    cerrada: { color: 'var(--status-closed)', bg: 'rgba(107,104,137,0.10)', label: 'CERRADA', dot: false },
    alerta: { color: 'var(--status-alert)', bg: 'var(--status-alert-bg)', label: 'ALERTA', dot: true },
  };
  const cfg = map[status] || map.activa;
  return (
    <span className="rl-mono rl-caps" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 8px', borderRadius: 'var(--r-pill)',
      background: cfg.bg, color: cfg.color,
      fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
      border: `1px solid ${cfg.color}33`,
    }}>
      {cfg.dot && (
        <span style={{
          width: 6, height: 6, borderRadius: 999, background: cfg.color,
          boxShadow: cfg.glow ? `0 0 8px ${cfg.color}` : 'none',
          animation: cfg.dot ? 'rl-pulse 1.6s ease-in-out infinite' : 'none',
        }} />
      )}
      {children || cfg.label}
    </span>
  );
}

// === EstadoChip ===
function EstadoChip({ code, name }) {
  return (
    <span className="rl-mono rl-caps" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 7px 3px 5px', borderRadius: 4,
      background: 'rgba(124,58,237,0.10)',
      border: '1px solid rgba(124,58,237,0.25)',
      color: 'var(--violet-300)',
      fontSize: 10, letterSpacing: '0.14em',
    }}>
      <span style={{
        fontSize: 9, padding: '1px 4px', borderRadius: 2,
        background: 'rgba(124,58,237,0.30)', color: 'var(--violet-300)',
      }}>{code}</span>
      {name}
    </span>
  );
}

// === MetaRow ===
function MetaRow({ icon, children }) {
  return (
    <div className="rl-mono rl-caps" style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.12em',
    }}>
      <span style={{ width: 12, height: 12, display: 'inline-flex' }}>{icon}</span>
      {children}
    </div>
  );
}

// === Icons (inline, lucide-style) ===
const Icon = {
  building: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/></svg>,
  pin: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  cal: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  doc: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  bell: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
  star: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  filter: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>,
  arrowR: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>,
  download: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>,
  ext: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>,
  sparkle: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.8L20 11l-6.1 1.8L12 19l-1.9-6.2L4 11l6.1-2.2z"/></svg>,
  grid: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  list: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  map: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  user: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  trend: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  chev: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  check: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  close: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  zap: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  shield: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
};

// === TopNav ===
function TopNav({ active = 'dashboard', onNav }) {
  const items = [
    { id: 'dashboard', label: 'Radar', icon: Icon.grid },
    { id: 'mapa', label: 'Mapa', icon: Icon.map },
    { id: 'tabla', label: 'Terminal', icon: Icon.list },
    { id: 'alertas', label: 'Alertas', icon: Icon.bell },
  ];
  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 28px', borderBottom: '1px solid var(--line-1)',
      background: 'rgba(11,14,24,0.85)',
      backdropFilter: 'blur(12px)',
      position: 'sticky', top: 0, zIndex: 50,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
        <RadarLogo size={32} />
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {items.map(it => (
            <button key={it.id} onClick={() => onNav?.(it.id)} className="rl-mono rl-caps" style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 8, border: 'none',
              background: active === it.id ? 'rgba(124,58,237,0.15)' : 'transparent',
              color: active === it.id ? 'var(--violet-300)' : 'var(--text-2)',
              fontSize: 11, letterSpacing: '0.14em', cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              transition: 'all var(--dur-fast) var(--ease-out)',
            }}>
              {it.icon} {it.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="rl-mono" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', borderRadius: 'var(--r-pill)',
          background: 'rgba(16,242,168,0.08)',
          border: '1px solid rgba(16,242,168,0.25)',
          fontSize: 10, color: 'var(--status-active)', letterSpacing: '0.14em',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: 999, background: 'var(--status-active)',
            boxShadow: '0 0 8px var(--status-active)',
            animation: 'rl-pulse 1.6s ease-in-out infinite',
          }} />
          LIVE · 12,847 INTEL
        </div>
        <button style={{
          width: 36, height: 36, borderRadius: 8, border: '1px solid var(--line-2)',
          background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          {Icon.bell}
          <span style={{
            position: 'absolute', top: 6, right: 6,
            width: 8, height: 8, borderRadius: 999, background: 'var(--status-alert)',
            boxShadow: '0 0 6px var(--status-alert)',
          }} />
        </button>
        <div style={{
          width: 36, height: 36, borderRadius: 999,
          background: 'linear-gradient(135deg, var(--violet-600), var(--cyan-500))',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 12, color: '#fff', fontWeight: 600,
          letterSpacing: '0.04em',
        }}>KT</div>
      </div>
    </nav>
  );
}

// === Counter (animated tabular) ===
function Counter({ value, prefix = '', suffix = '', duration = 1400 }) {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    let raf, t0;
    const step = (t) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / duration);
      // ease-out
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.floor(eased * value));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="rl-counter">{prefix}{v.toLocaleString('es-MX')}{suffix}</span>;
}

// === Money formatter ===
function fmtMXN(n) {
  if (n == null) return 'Abierto';
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(0)}K`;
  return `$${n}`;
}

Object.assign(window, { StatusPill, EstadoChip, MetaRow, Icon, TopNav, Counter, fmtMXN });
