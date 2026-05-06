// Terminal — vista de tabla densa estilo Bloomberg

function Terminal() {
  const data = window.RL_DATA;
  const rows = [...data.licitaciones, ...data.licitaciones].slice(0, 18).map((l, i) => ({
    ...l,
    id: l.id + (i > 11 ? `-${i}` : ''),
    score: (Math.sin(i * 0.7) * 2.5 + 7).toFixed(1),
  }));

  return (
    <div className="rl-frame" style={{
      minHeight: 1080,
      background: 'var(--bg-0)',
    }}>
      <TopNav active="tabla" />

      {/* Terminal header bar */}
      <div style={{
        padding: '12px 28px', borderBottom: '1px solid var(--line-1)',
        background: 'rgba(11,14,24,0.6)',
        display: 'flex', alignItems: 'center', gap: 16,
        fontFamily: 'var(--font-mono)',
      }}>
        <span className="rl-mono rl-caps" style={{
          padding: '4px 10px', borderRadius: 4,
          background: 'rgba(16,242,168,0.10)', border: '1px solid rgba(16,242,168,0.30)',
          color: 'var(--status-active)', fontSize: 10, letterSpacing: '0.18em',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--status-active)', boxShadow: '0 0 6px var(--status-active)' }} />
          TERMINAL · LIVE
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>F1 Help</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>F2 Filter</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>F3 Export</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>F4 Alert</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>F5 Refresh</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--cyan-400)' }}>05.05.2026 · 14:42:08 GMT-6</span>
      </div>

      {/* Quick filter chips */}
      <div style={{
        padding: '12px 28px', borderBottom: '1px solid var(--line-1)',
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.14em', marginRight: 4 }}>QUERY:</span>
        {[
          { label: 'status:activa', active: true },
          { label: 'monto:>10M' },
          { label: 'estado:cmx' },
          { label: 'tipo:obra' },
          { label: '+' },
        ].map((f, i) => (
          <span key={i} className="rl-mono" style={{
            padding: '5px 10px', borderRadius: 4,
            background: f.active ? 'rgba(34,211,238,0.10)' : 'transparent',
            border: `1px solid ${f.active ? 'rgba(34,211,238,0.30)' : 'var(--line-2)'}`,
            color: f.active ? 'var(--cyan-400)' : 'var(--text-3)',
            fontSize: 11, cursor: 'pointer',
          }}>{f.label}</span>
        ))}
        <div style={{ flex: 1 }} />
        <span className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.14em' }}>
          {rows.length} resultados · ordenado por <span style={{ color: 'var(--cyan-400)' }}>score ↓</span>
        </span>
      </div>

      {/* Table */}
      <div style={{ padding: '0 28px' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontFamily: 'var(--font-mono)', fontSize: 12,
        }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line-2)' }}>
              {[
                { l: 'STATUS', w: 90 },
                { l: 'NUC', w: 220 },
                { l: 'TÍTULO', w: 'auto' },
                { l: 'DEP', w: 90 },
                { l: 'EST', w: 60 },
                { l: 'TIPO', w: 90 },
                { l: 'MONTO', w: 100, n: true },
                { l: 'OFERTAS', w: 80, n: true },
                { l: 'CIERRA', w: 90 },
                { l: 'SCORE', w: 70, n: true },
              ].map((c, i) => (
                <th key={i} style={{
                  padding: '12px 8px', textAlign: c.n ? 'right' : 'left',
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.16em',
                  color: 'var(--text-3)', textTransform: 'uppercase',
                  width: c.w === 'auto' ? undefined : c.w,
                  cursor: 'pointer',
                }}>{c.l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isAlert = r.alerta;
              const isNew = r.nuevo;
              return (
                <tr key={r.id} style={{
                  borderBottom: '1px solid var(--line-1)',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(124,58,237,0.02)',
                  transition: 'background .12s',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(124,58,237,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(124,58,237,0.02)'}
                >
                  <td style={{ padding: '10px 8px' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 10, letterSpacing: '0.14em',
                      color: isAlert ? 'var(--status-alert)' : isNew ? 'var(--cyan-400)' : 'var(--status-active)',
                    }}>
                      <span style={{
                        width: 5, height: 5, borderRadius: 999,
                        background: 'currentColor',
                        boxShadow: '0 0 6px currentColor',
                        animation: 'rl-pulse 1.6s ease-in-out infinite',
                      }} />
                      {isAlert ? 'ALERT' : isNew ? 'NEW' : 'LIVE'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 8px', color: 'var(--violet-300)', fontSize: 11 }}>
                    {r.id.length > 26 ? r.id.slice(0, 26) + '…' : r.id}
                  </td>
                  <td style={{ padding: '10px 8px', color: 'var(--text-1)', fontSize: 12, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.titulo}
                  </td>
                  <td style={{ padding: '10px 8px', color: 'var(--cyan-400)' }}>{r.dep}</td>
                  <td style={{ padding: '10px 8px', color: 'var(--violet-300)' }}>{r.estado}</td>
                  <td style={{ padding: '10px 8px', color: 'var(--text-2)', fontSize: 11 }}>{r.tipo}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-1)', fontWeight: 600 }}>{r.montoLabel}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-2)' }}>{r.ofertas}</td>
                  <td style={{ padding: '10px 8px', color: r.alerta ? 'var(--status-alert)' : 'var(--text-2)', fontSize: 11 }}>{r.cierra}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                    <span style={{
                      display: 'inline-block', minWidth: 36,
                      padding: '2px 8px', borderRadius: 3,
                      background: parseFloat(r.score) > 7.5 ? 'rgba(16,242,168,0.12)' : 'rgba(124,58,237,0.10)',
                      color: parseFloat(r.score) > 7.5 ? 'var(--status-active)' : 'var(--violet-300)',
                      border: `1px solid ${parseFloat(r.score) > 7.5 ? 'rgba(16,242,168,0.30)' : 'rgba(124,58,237,0.25)'}`,
                      fontWeight: 600,
                    }}>{r.score}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom status bar */}
      <div style={{
        marginTop: 24, padding: '10px 28px',
        borderTop: '1px solid var(--line-1)',
        background: 'rgba(11,14,24,0.85)',
        display: 'flex', alignItems: 'center', gap: 24,
        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)',
      }}>
        <span>● connected</span>
        <span>latency: <span style={{ color: 'var(--cyan-400)' }}>42ms</span></span>
        <span>last sync: <span style={{ color: 'var(--text-1)' }}>3s ago</span></span>
        <span>scrape rate: <span style={{ color: 'var(--status-active)' }}>1.2/s</span></span>
        <div style={{ flex: 1 }} />
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>/ search</span>
        <span>esc back</span>
      </div>
    </div>
  );
}

window.Terminal = Terminal;
