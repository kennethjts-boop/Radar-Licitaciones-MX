// LicitacionCard — la pieza clave que reemplaza las cards sosas

function LicitacionCard({ data, density = 'comfy', cardStyle = 'glow', onClick }) {
  const compact = density === 'compact';
  const isGlow = cardStyle === 'glow';
  const isFlat = cardStyle === 'flat';

  const hasMonto = data.monto != null;
  const status = data.alerta ? 'alerta' : (data.status === 'cerrando' ? 'cerrando' : 'activa');

  // Mini sparkline (deterministic from id)
  const seed = data.id.length;
  const spark = Array.from({ length: 16 }, (_, i) => {
    const v = (Math.sin((seed + i) * 0.7) + Math.cos((seed * 0.3 + i) * 0.5)) * 0.5 + 0.5;
    return Math.max(0.15, Math.min(0.95, v));
  });

  return (
    <article
      onClick={onClick}
      style={{
        position: 'relative',
        background: isFlat ? 'var(--bg-1)' : 'linear-gradient(180deg, var(--bg-2) 0%, var(--bg-1) 100%)',
        border: '1px solid var(--line-1)',
        borderRadius: 'var(--r-lg)',
        padding: compact ? 14 : 18,
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'all var(--dur-base) var(--ease-out)',
        boxShadow: isGlow ? 'var(--shadow-card)' : (isFlat ? 'none' : 'var(--shadow-card)'),
      }}
      onMouseEnter={e => {
        if (isGlow) {
          e.currentTarget.style.borderColor = 'rgba(124,58,237,0.45)';
          e.currentTarget.style.boxShadow = '0 0 0 1px rgba(124,58,237,0.30), 0 0 32px rgba(124,58,237,0.18), 0 12px 32px rgba(0,0,0,0.50)';
          e.currentTarget.style.transform = 'translateY(-2px)';
        } else {
          e.currentTarget.style.borderColor = 'var(--line-3)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--line-1)';
        e.currentTarget.style.boxShadow = isFlat ? 'none' : 'var(--shadow-card)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Decorative corner crosshair */}
      <svg width="16" height="16" viewBox="0 0 16 16" style={{
        position: 'absolute', top: 8, right: 8, opacity: 0.30, color: 'var(--violet-400)',
      }}>
        <path d="M0 1 L0 0 L1 0 M15 0 L16 0 L16 1 M16 15 L16 16 L15 16 M1 16 L0 16 L0 15"
          stroke="currentColor" strokeWidth="1" fill="none" />
      </svg>

      {/* New flag */}
      {data.nuevo && (
        <div style={{
          position: 'absolute', top: 0, left: 0,
          width: 0, height: 0,
          borderTop: '36px solid var(--cyan-500)',
          borderRight: '36px solid transparent',
          opacity: 0.85,
        }} />
      )}
      {data.nuevo && (
        <span className="rl-mono" style={{
          position: 'absolute', top: 4, left: 4,
          fontSize: 8, color: '#06070C', fontWeight: 700, letterSpacing: '0.08em',
          transform: 'rotate(-45deg)', transformOrigin: 'left top',
        }}>NEW</span>
      )}

      {/* Header row: status + ID */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 10 : 14 }}>
        <StatusPill status={status} />
        <span className="rl-mono" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.10em' }}>
          {data.id.length > 22 ? data.id.slice(0, 22) + '…' : data.id}
        </span>
      </div>

      {/* Title */}
      <h3 style={{
        margin: 0,
        fontFamily: 'var(--font-display)',
        fontSize: compact ? 14 : 15,
        fontWeight: 600,
        lineHeight: 1.35,
        color: 'var(--text-1)',
        letterSpacing: '-0.005em',
        display: '-webkit-box',
        WebkitLineClamp: compact ? 2 : 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        marginBottom: compact ? 10 : 14,
        textWrap: 'balance',
      }}>
        {data.titulo}
      </h3>

      {/* Meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: compact ? 10 : 14 }}>
        <MetaRow icon={Icon.building}>
          <span style={{ color: 'var(--text-2)' }}>{data.dep}</span>
          <span style={{ color: 'var(--text-4)' }}>·</span>
          <span style={{ color: 'var(--text-3)' }}>{data.tipo}</span>
        </MetaRow>
        <MetaRow icon={Icon.pin}>
          <span style={{ color: 'var(--violet-300)' }}>{data.estado}</span>
          <span style={{ color: 'var(--text-3)', textTransform: 'none', letterSpacing: 0 }}>· {data.estadoFull}</span>
        </MetaRow>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--line-2), transparent)', marginBottom: compact ? 10 : 12 }} />

      {/* Bottom: monto + sparkline + cta */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 4 }}>
            Monto
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: compact ? 16 : 19,
            fontWeight: 600,
            color: hasMonto ? 'var(--text-1)' : 'var(--cyan-400)',
            letterSpacing: '-0.01em',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {data.montoLabel}
          </div>
          <div className="rl-mono" style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 2, letterSpacing: '0.04em' }}>
            cierra {data.cierra} · {data.ofertas} ofertas
          </div>
        </div>

        {/* Mini sparkline of "interés" */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28, opacity: 0.85 }}>
          {spark.map((h, i) => (
            <span key={i} style={{
              width: 3,
              height: `${h * 100}%`,
              background: i === spark.length - 1
                ? 'var(--cyan-400)'
                : `rgba(124,58,237,${0.35 + h * 0.5})`,
              borderRadius: 1.5,
              boxShadow: i === spark.length - 1 ? '0 0 4px var(--cyan-400)' : 'none',
            }} />
          ))}
        </div>
      </div>
    </article>
  );
}

window.LicitacionCard = LicitacionCard;
