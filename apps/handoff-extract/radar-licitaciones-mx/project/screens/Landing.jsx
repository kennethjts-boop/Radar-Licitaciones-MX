// Landing — hero público con marca completa

function Landing() {
  return (
    <div className="rl-frame" style={{
      minHeight: 1200,
      background: `
        radial-gradient(900px 600px at 75% 0%, rgba(124,58,237,0.18), transparent 60%),
        radial-gradient(700px 500px at 0% 80%, rgba(6,182,212,0.10), transparent 60%),
        var(--bg-0)
      `,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Grid background */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, opacity: 0.35, pointerEvents: 'none',
        backgroundImage: `
          linear-gradient(rgba(124,58,237,0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(124,58,237,0.08) 1px, transparent 1px)
        `,
        backgroundSize: '64px 64px',
        maskImage: 'radial-gradient(circle at 50% 30%, #000 30%, transparent 75%)',
      }} />

      {/* Nav */}
      <nav style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 40px',
      }}>
        <RadarLogo size={36} />
        <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          {['Producto', 'Datos', 'Precios', 'API', 'Casos'].map(l => (
            <a key={l} className="rl-mono rl-caps" style={{
              fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-2)',
              textDecoration: 'none', cursor: 'pointer',
            }}>{l}</a>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="rl-mono rl-caps" style={{
            padding: '10px 16px', borderRadius: 'var(--r-md)',
            background: 'transparent', border: '1px solid var(--line-2)',
            color: 'var(--text-2)', fontSize: 11, letterSpacing: '0.14em', cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
          }}>Iniciar sesión</button>
          <button className="rl-mono rl-caps" style={{
            padding: '10px 18px', borderRadius: 'var(--r-md)',
            background: 'linear-gradient(135deg, var(--violet-600), var(--violet-700))',
            border: '1px solid var(--violet-500)',
            color: '#fff', fontSize: 11, letterSpacing: '0.14em', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', boxShadow: 'var(--glow-violet)',
          }}>Probar gratis →</button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        position: 'relative', padding: '60px 40px 80px',
        display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 40, alignItems: 'center',
      }}>
        <div>
          {/* Badge */}
          <div className="rl-mono rl-caps" style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '6px 12px', borderRadius: 'var(--r-pill)',
            background: 'rgba(16,242,168,0.08)', border: '1px solid rgba(16,242,168,0.25)',
            color: 'var(--status-active)', fontSize: 10, letterSpacing: '0.18em',
            marginBottom: 28,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999, background: 'var(--status-active)',
              boxShadow: '0 0 8px var(--status-active)',
              animation: 'rl-pulse 1.6s ease-in-out infinite',
            }} />
            12,847 licitaciones rastreadas en vivo · CompraNet & ITP
          </div>

          {/* Headline */}
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-display)',
            fontSize: 'clamp(56px, 6.5vw, 88px)', fontWeight: 600,
            lineHeight: 0.98, letterSpacing: '-0.035em', color: 'var(--text-1)',
            textWrap: 'balance',
          }}>
            Inteligencia<br/>
            de licitaciones<br/>
            <span style={{
              background: 'linear-gradient(120deg, var(--violet-400), var(--cyan-400) 60%, var(--magenta-400))',
              WebkitBackgroundClip: 'text', backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>en tiempo real.</span>
          </h1>

          {/* Sub */}
          <p style={{
            margin: '24px 0 0', maxWidth: 560,
            fontSize: 18, lineHeight: 1.55, color: 'var(--text-2)',
          }}>
            Radar Licitaciones MX rastrea cada compra pública del gobierno mexicano.
            Filtra por estado, dependencia o monto, y recibe alertas el instante en que
            una oportunidad se publica.
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', gap: 12, marginTop: 36 }}>
            <button className="rl-mono rl-caps" style={{
              padding: '16px 24px', borderRadius: 'var(--r-md)',
              background: 'linear-gradient(135deg, var(--violet-600), var(--violet-700))',
              border: '1px solid var(--violet-500)',
              color: '#fff', fontSize: 12, letterSpacing: '0.16em', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', boxShadow: 'var(--glow-violet)',
              display: 'inline-flex', alignItems: 'center', gap: 10,
            }}>
              Empezar gratis {Icon.arrowR}
            </button>
            <button className="rl-mono rl-caps" style={{
              padding: '16px 24px', borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              color: 'var(--text-1)', fontSize: 12, letterSpacing: '0.16em', cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              display: 'inline-flex', alignItems: 'center', gap: 10,
            }}>
              {Icon.zap} Ver demo en vivo
            </button>
          </div>

          {/* Trust strip */}
          <div style={{ marginTop: 48, display: 'flex', gap: 32, alignItems: 'center' }}>
            <div className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.16em' }}>
              Fuentes oficiales:
            </div>
            {['CompraNet', 'ITP', 'DOF', 'Plataforma Nacional', 'Tianguis Digital'].map(s => (
              <div key={s} className="rl-mono" style={{
                fontSize: 12, color: 'var(--text-2)', letterSpacing: '0.04em',
                opacity: 0.75,
              }}>{s}</div>
            ))}
          </div>
        </div>

        {/* Right: animated radar device */}
        <div style={{
          position: 'relative', aspectRatio: '1', maxWidth: 520,
          margin: '0 auto', justifySelf: 'center',
        }}>
          {/* Big radar svg */}
          <svg viewBox="0 0 400 400" style={{ width: '100%', height: '100%' }}>
            <defs>
              <radialGradient id="hero-bg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#1A1240" />
                <stop offset="70%" stopColor="#0B0E18" />
                <stop offset="100%" stopColor="#06070C" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="hero-sweep" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7C3AED" stopOpacity="0" />
                <stop offset="60%" stopColor="#7C3AED" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.9" />
              </linearGradient>
            </defs>

            {/* BG disc */}
            <circle cx="200" cy="200" r="190" fill="url(#hero-bg)" stroke="rgba(124,58,237,0.40)" strokeWidth="1" />
            {/* Rings */}
            {[160, 120, 80, 40].map(r => (
              <circle key={r} cx="200" cy="200" r={r} fill="none"
                stroke={`rgba(124,58,237,${0.30 - r / 600})`} strokeWidth="0.75" strokeDasharray={r === 80 ? '2 4' : ''} />
            ))}
            {/* Crosshair */}
            <line x1="200" y1="10" x2="200" y2="390" stroke="rgba(255,255,255,0.08)" strokeWidth="0.75" />
            <line x1="10" y1="200" x2="390" y2="200" stroke="rgba(255,255,255,0.08)" strokeWidth="0.75" />
            {/* Diag */}
            <line x1="65" y1="65" x2="335" y2="335" stroke="rgba(255,255,255,0.04)" strokeWidth="0.75" />
            <line x1="335" y1="65" x2="65" y2="335" stroke="rgba(255,255,255,0.04)" strokeWidth="0.75" />

            {/* Sweep */}
            <g style={{ transformOrigin: '200px 200px', animation: 'rl-radar-sweep 4s linear infinite' }}>
              <path d="M200 200 L390 200 A190 190 0 0 0 312.43 41.62 Z" fill="url(#hero-sweep)" opacity="0.9" />
            </g>

            {/* Mexico-shaped blip cluster (suggested) */}
            {[
              { x: 140, y: 140, r: 4, c: '#10F2A8', d: 0, label: 'CDMX · $24.1B' },
              { x: 175, y: 165, r: 3, c: '#22D3EE', d: 0.4 },
              { x: 110, y: 195, r: 3, c: '#10F2A8', d: 0.8 },
              { x: 230, y: 130, r: 5, c: '#D946EF', d: 1.2, label: 'NLE · $9.1B' },
              { x: 260, y: 175, r: 3, c: '#22D3EE', d: 1.6 },
              { x: 200, y: 240, r: 4, c: '#10F2A8', d: 2.0, label: 'OAX · $3.8B' },
              { x: 290, y: 230, r: 3, c: '#7C3AED', d: 2.4 },
              { x: 155, y: 265, r: 3, c: '#22D3EE', d: 2.8 },
              { x: 245, y: 290, r: 4, c: '#10F2A8', d: 3.2 },
              { x: 95, y: 235, r: 2.5, c: '#22D3EE', d: 0.2 },
            ].map((b, i) => (
              <g key={i}>
                {/* Pulse ring */}
                <circle cx={b.x} cy={b.y} r={b.r * 4} fill="none" stroke={b.c} strokeWidth="0.5" opacity="0.5"
                  style={{ animation: `rl-pulse 2.4s ease-out infinite ${b.d}s`, transformOrigin: `${b.x}px ${b.y}px` }} />
                <circle cx={b.x} cy={b.y} r={b.r} fill={b.c} style={{ filter: `drop-shadow(0 0 6px ${b.c})` }} />
              </g>
            ))}

            {/* Center */}
            <circle cx="200" cy="200" r="4" fill="#F5F3FF" />
            <circle cx="200" cy="200" r="10" fill="none" stroke="rgba(245,243,255,0.30)" strokeWidth="0.75" />

            {/* Floating data tags */}
            <g>
              <rect x="240" y="120" width="120" height="36" rx="6" fill="rgba(11,14,24,0.85)" stroke="rgba(124,58,237,0.45)" strokeWidth="1" />
              <text x="252" y="135" fontFamily="JetBrains Mono" fontSize="9" fill="#10F2A8" letterSpacing="2">+ NUEVA · LIVE</text>
              <text x="252" y="148" fontFamily="JetBrains Mono" fontSize="11" fill="#F5F3FF" fontWeight="600">SEDENA · $412M</text>
            </g>
            <g>
              <rect x="40" y="240" width="130" height="36" rx="6" fill="rgba(11,14,24,0.85)" stroke="rgba(6,182,212,0.45)" strokeWidth="1" />
              <text x="52" y="255" fontFamily="JetBrains Mono" fontSize="9" fill="#22D3EE" letterSpacing="2">⚡ CIERRA 24H</text>
              <text x="52" y="268" fontFamily="JetBrains Mono" fontSize="11" fill="#F5F3FF" fontWeight="600">ISSSTE · $142.3M</text>
            </g>
          </svg>

          {/* Floating stat card */}
          <div style={{
            position: 'absolute', top: '8%', left: '-8%',
            padding: 14, borderRadius: 'var(--r-md)',
            background: 'rgba(11,14,24,0.85)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(124,58,237,0.40)',
            boxShadow: 'var(--glow-violet)',
            minWidth: 180,
            animation: 'rl-rise .8s var(--ease-out) both',
          }}>
            <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--violet-300)', letterSpacing: '0.18em', marginBottom: 6 }}>
              ◉ Detectadas hoy
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
              <Counter value={142} />
            </div>
            <div className="rl-mono" style={{ fontSize: 10, color: 'var(--status-active)', marginTop: 4 }}>
              ▲ +18% vs ayer
            </div>
          </div>

          <div style={{
            position: 'absolute', bottom: '5%', right: '-5%',
            padding: 14, borderRadius: 'var(--r-md)',
            background: 'rgba(11,14,24,0.85)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(6,182,212,0.40)',
            boxShadow: 'var(--glow-cyan)',
            minWidth: 200,
          }}>
            <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--cyan-400)', letterSpacing: '0.18em', marginBottom: 6 }}>
              ⚡ Monto rastreado · 2026
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
              $89.42<span style={{ color: 'var(--cyan-400)' }}>B</span> MXN
            </div>
          </div>
        </div>
      </section>

      {/* Feature strip */}
      <section style={{
        padding: '40px',
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16,
        position: 'relative',
      }}>
        {[
          { icon: Icon.zap, title: 'Tiempo real', body: 'Notificaciones < 60 seg desde que se publica en CompraNet, ITP o DOF.' },
          { icon: Icon.filter, title: 'Filtros quirúrgicos', body: '32 estados · 247 dependencias · monto · tipo · NUC · palabras clave.' },
          { icon: Icon.map, title: 'Mapa de calor', body: 'Visualiza concentración de licitaciones por estado y descubre patrones.' },
          { icon: Icon.shield, title: 'Datos verificados', body: 'Trazabilidad oficial: cada registro liga al expediente fuente.' },
        ].map((f, i) => (
          <div key={i} style={{
            padding: 24, borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)', border: '1px solid var(--line-1)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 'var(--r-md)',
              background: 'linear-gradient(135deg, rgba(124,58,237,0.20), rgba(6,182,212,0.10))',
              border: '1px solid rgba(124,58,237,0.30)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--violet-300)', marginBottom: 14,
            }}>{f.icon}</div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>{f.title}</h3>
            <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)' }}>{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

window.Landing = Landing;
