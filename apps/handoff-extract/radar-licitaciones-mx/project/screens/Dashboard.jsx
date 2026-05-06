// Dashboard — vista principal del radar (mejora del actual)

function Dashboard({ tweaks }) {
  const data = window.RL_DATA;
  const [query, setQuery] = React.useState('');
  const [estado, setEstado] = React.useState('Todos');
  const [view, setView] = React.useState('grid');

  return (
    <div className="rl-frame" style={{
      minHeight: 1080,
      background: `
        radial-gradient(1200px 600px at 80% -10%, var(--bg-glow), transparent 60%),
        radial-gradient(800px 500px at 0% 100%, rgba(6,182,212,0.10), transparent 60%),
        var(--bg-0)
      `,
    }}>
      <TopNav active="dashboard" />

      {/* Stats strip */}
      <section style={{
        padding: '24px 28px',
        borderBottom: '1px solid var(--line-1)',
        display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 16,
        background: 'linear-gradient(180deg, rgba(124,58,237,0.04), transparent)',
      }}>
        {/* Hero counter */}
        <div style={{
          padding: 20, borderRadius: 'var(--r-lg)',
          background: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(6,182,212,0.10))',
          border: '1px solid rgba(124,58,237,0.30)',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Scan line */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(180deg, transparent, rgba(34,211,238,0.10) 50%, transparent)',
            height: '20%', animation: 'rl-scan 4s linear infinite',
          }} />
          <div className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--violet-300)', letterSpacing: '0.18em', marginBottom: 8 }}>
            ◉ Inteligencia · México · Live
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 44, fontWeight: 600,
              color: 'var(--text-1)', letterSpacing: '-0.02em', lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}>
              <Counter value={data.stats.total} />
            </div>
            <div className="rl-mono rl-caps" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.14em' }}>
              licitaciones rastreadas
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 12 }}>
            <span className="rl-mono" style={{ fontSize: 11, color: 'var(--status-active)', letterSpacing: '0.06em' }}>
              ▲ +{data.stats.nuevas_hoy} hoy
            </span>
            <span className="rl-mono" style={{ fontSize: 11, color: 'var(--status-closing)', letterSpacing: '0.06em' }}>
              ⏱ {data.stats.cerrando_24h} cierran 24h
            </span>
          </div>
        </div>

        {[
          { label: 'Activas', value: data.stats.activas, color: 'var(--status-active)', suffix: '' },
          { label: 'Monto Σ', value: 89.42, color: 'var(--cyan-400)', suffix: 'B', prefix: '$' },
          { label: 'Dependencias', value: 247, color: 'var(--violet-400)', suffix: '' },
          { label: 'Estados', value: 32, color: 'var(--magenta-400)', suffix: '/32' },
        ].map(s => (
          <div key={s.label} style={{
            padding: 20, borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)', border: '1px solid var(--line-1)',
          }}>
            <div className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 10 }}>
              {s.label}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 600,
              color: s.color, letterSpacing: '-0.01em', lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {s.prefix || ''}{typeof s.value === 'number' && s.value < 1000 ? s.value.toLocaleString('es-MX') : <Counter value={s.value} />}{s.suffix}
            </div>
          </div>
        ))}
      </section>

      {/* Search + filters */}
      <section style={{ padding: '20px 28px', display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderRadius: 'var(--r-md)',
          background: 'var(--bg-2)', border: '1px solid var(--line-2)',
          transition: 'all var(--dur-fast) var(--ease-out)',
        }}>
          <span style={{ color: 'var(--text-3)' }}>{Icon.search}</span>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Buscar licitación, dependencia, expediente, NUC…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-1)', fontSize: 14, fontFamily: 'var(--font-sans)',
            }}
          />
          <span className="rl-mono" style={{
            padding: '3px 7px', borderRadius: 4, background: 'var(--bg-3)',
            fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.04em',
            border: '1px solid var(--line-2)',
          }}>⌘K</span>
        </div>

        {[
          { label: estado, icon: Icon.pin },
          { label: 'Todas las dependencias', icon: Icon.building },
          { label: 'Cualquier monto', icon: Icon.trend },
          { label: 'Cualquier fecha', icon: Icon.cal },
        ].map((f, i) => (
          <button key={i} className="rl-mono rl-caps" style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 14px', borderRadius: 'var(--r-md)',
            background: 'var(--bg-2)', border: '1px solid var(--line-2)',
            color: 'var(--text-2)', fontSize: 10, letterSpacing: '0.12em',
            cursor: 'pointer', fontFamily: 'var(--font-mono)',
          }}>
            <span style={{ color: 'var(--text-3)' }}>{f.icon}</span>
            {f.label}
            <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>{Icon.chev}</span>
          </button>
        ))}

        <div style={{
          display: 'flex', borderRadius: 'var(--r-md)',
          background: 'var(--bg-2)', border: '1px solid var(--line-2)', padding: 3,
        }}>
          {['grid', 'list', 'map'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '8px 10px', borderRadius: 6, border: 'none',
              background: view === v ? 'var(--bg-3)' : 'transparent',
              color: view === v ? 'var(--violet-300)' : 'var(--text-3)',
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
            }}>
              {v === 'grid' ? Icon.grid : v === 'list' ? Icon.list : Icon.map}
            </button>
          ))}
        </div>
      </section>

      {/* Live ticker */}
      <section style={{
        margin: '0 28px',
        padding: '10px 16px',
        borderRadius: 'var(--r-md)',
        background: 'linear-gradient(90deg, rgba(16,242,168,0.06), rgba(6,182,212,0.04), rgba(124,58,237,0.04))',
        border: '1px solid var(--line-1)',
        display: 'flex', alignItems: 'center', gap: 16, overflow: 'hidden',
      }}>
        <span className="rl-mono rl-caps" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px',
          background: 'rgba(16,242,168,0.12)', border: '1px solid rgba(16,242,168,0.30)',
          color: 'var(--status-active)', fontSize: 9, letterSpacing: '0.18em',
          borderRadius: 'var(--r-pill)', flexShrink: 0,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--status-active)', boxShadow: '0 0 6px var(--status-active)', animation: 'rl-pulse 1.4s ease-in-out infinite' }} />
          STREAM
        </span>
        <div style={{ display: 'flex', gap: 28, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {data.stream.map((s, i) => (
            <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span className="rl-mono" style={{ color: 'var(--text-3)', fontSize: 10 }}>{s.time}</span>
              <span style={{
                width: 6, height: 6, borderRadius: 999,
                background: s.kind === 'new' ? 'var(--status-new)' : s.kind === 'closing' ? 'var(--status-closing)' : s.kind === 'award' ? 'var(--magenta-400)' : 'var(--violet-400)',
              }} />
              <span style={{ color: 'var(--text-2)' }}>{s.text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Card grid */}
      <section style={{ padding: '20px 28px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{
              margin: 0, fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600,
              color: 'var(--text-1)', letterSpacing: '-0.015em',
            }}>
              Radar activo
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-3)', fontSize: 13 }}>
              {data.licitaciones.length} resultados · ordenado por relevancia
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="rl-mono rl-caps" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              color: 'var(--text-2)', fontSize: 10, letterSpacing: '0.14em',
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}>
              {Icon.download} Exportar CSV
            </button>
            <button className="rl-mono rl-caps" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', borderRadius: 'var(--r-md)',
              background: 'linear-gradient(135deg, var(--violet-600), var(--violet-700))',
              border: '1px solid var(--violet-500)',
              color: '#fff', fontSize: 10, letterSpacing: '0.14em',
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
              boxShadow: 'var(--glow-violet)',
            }}>
              {Icon.bell} Crear alerta
            </button>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: tweaks.density === 'compact' ? 'repeat(5, 1fr)' : 'repeat(4, 1fr)',
          gap: tweaks.density === 'compact' ? 12 : 16,
        }}>
          {data.licitaciones.map(l => (
            <LicitacionCard key={l.id} data={l} density={tweaks.density} cardStyle={tweaks.cardStyle} />
          ))}
        </div>
      </section>
    </div>
  );
}

window.Dashboard = Dashboard;
