// Login y Alertas

function Login() {
  return (
    <div className="rl-frame" style={{
      minHeight: 1080,
      background: `
        radial-gradient(700px 400px at 20% 30%, rgba(124,58,237,0.20), transparent 60%),
        radial-gradient(600px 400px at 80% 80%, rgba(6,182,212,0.12), transparent 60%),
        var(--bg-0)
      `,
      display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden',
    }}>
      {/* Left: brand */}
      <div style={{
        position: 'relative', padding: 56,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}>
        {/* Grid bg */}
        <div aria-hidden style={{
          position: 'absolute', inset: 0, opacity: 0.4,
          backgroundImage: `linear-gradient(rgba(124,58,237,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.08) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(circle at 30% 50%, #000 30%, transparent 70%)',
        }} />

        <RadarLogo size={36} />

        {/* Center radar */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="rl-mono rl-caps" style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '6px 12px', borderRadius: 'var(--r-pill)',
            background: 'rgba(16,242,168,0.08)', border: '1px solid rgba(16,242,168,0.25)',
            color: 'var(--status-active)', fontSize: 10, letterSpacing: '0.18em',
            marginBottom: 24,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--status-active)', boxShadow: '0 0 8px var(--status-active)', animation: 'rl-pulse 1.6s ease-in-out infinite' }} />
            12,847 licitaciones · 32 estados · live
          </div>
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontSize: 56, fontWeight: 600,
            lineHeight: 1.05, letterSpacing: '-0.03em', color: 'var(--text-1)',
            textWrap: 'balance', maxWidth: 480,
          }}>
            Encuentra la próxima licitación{' '}
            <span style={{
              background: 'linear-gradient(120deg, var(--violet-400), var(--cyan-400))',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>antes que tu competencia.</span>
          </h1>
          <p style={{ margin: '20px 0 0', maxWidth: 460, color: 'var(--text-2)', fontSize: 15, lineHeight: 1.6 }}>
            Inicia sesión para activar alertas, guardar búsquedas y exportar datos en tiempo real.
          </p>
        </div>

        {/* Bottom: testimonial */}
        <div style={{
          padding: 20, borderRadius: 'var(--r-lg)',
          background: 'rgba(11,14,24,0.6)', backdropFilter: 'blur(8px)',
          border: '1px solid var(--line-2)', maxWidth: 460, position: 'relative', zIndex: 1,
        }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)', fontStyle: 'italic' }}>
            "Pasamos de revisar CompraNet manualmente cada mañana a recibir 3-4 oportunidades
            curadas por hora. El ROI fue inmediato."
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 999,
              background: 'linear-gradient(135deg, var(--violet-500), var(--cyan-500))',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 11, color: '#fff', fontWeight: 600,
            }}>MR</div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-1)' }}>Mariana Reyes</div>
              <div className="rl-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>Directora · Constructora Pacífico SA</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div style={{
        padding: 56, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderLeft: '1px solid var(--line-1)',
        background: 'rgba(11,14,24,0.4)',
      }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <div className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--violet-300)', letterSpacing: '0.18em', marginBottom: 8 }}>
            ◉ Acceso
          </div>
          <h2 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 600,
            color: 'var(--text-1)', letterSpacing: '-0.02em',
          }}>Inicia sesión</h2>
          <p style={{ margin: '6px 0 32px', color: 'var(--text-3)', fontSize: 14 }}>
            ¿Nuevo? <a style={{ color: 'var(--cyan-400)', textDecoration: 'none', cursor: 'pointer' }}>Crear cuenta gratis →</a>
          </p>

          {/* SSO */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            <button style={{
              padding: '12px 16px', borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              color: 'var(--text-1)', fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              fontFamily: 'var(--font-sans)',
            }}>
              <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.5 6.2 29.5 4 24 4C12.9 4 4 12.9 4 24s8.9 20 20 20s20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8c1.8-4.4 6.1-7.5 11.1-7.5c3.1 0 5.8 1.2 8 3l5.7-5.7C34.5 6.2 29.5 4 24 4C16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.4 0 10.3-2.1 14-5.4l-6.5-5.5c-2 1.4-4.6 2.3-7.5 2.3c-5.2 0-9.6-3.3-11.3-7.9l-6.6 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4 5.6l6.5 5.5c-.5.4 6.2-4.6 6.2-15.1c0-1.3-.1-2.7-.4-3.9z"/></svg>
              Continuar con Google
            </button>
            <button style={{
              padding: '12px 16px', borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              color: 'var(--text-1)', fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.174c-.105-.949-.199-2.403.041-3.439c.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911c1.024 0 1.518.769 1.518 1.688c0 1.029-.653 2.567-.992 3.992c-.285 1.193.6 2.165 1.775 2.165c2.128 0 3.768-2.245 3.768-5.487c0-2.861-2.063-4.869-5.008-4.869c-3.41 0-5.409 2.562-5.409 5.199c0 1.033.394 2.143.889 2.741c.099.12.112.225.085.345c-.09.375-.293 1.199-.334 1.363c-.053.225-.172.271-.402.165c-1.495-.69-2.433-2.878-2.433-4.646c0-3.776 2.748-7.252 7.92-7.252c4.158 0 7.392 2.967 7.392 6.923c0 4.135-2.607 7.462-6.233 7.462c-1.214 0-2.357-.629-2.749-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24C18.624 24 23.991 18.633 23.991 12.017C23.991 5.367 18.624.001 12.017.001z"/></svg>
              Continuar con Microsoft
            </button>
          </div>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--line-2)' }} />
            <span className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.18em' }}>O CON EMAIL</span>
            <div style={{ flex: 1, height: 1, background: 'var(--line-2)' }} />
          </div>

          {/* Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.18em', marginBottom: 6, display: 'block' }}>EMAIL</label>
              <input type="email" placeholder="tu@empresa.mx" style={{
                width: '100%', padding: '12px 14px', borderRadius: 'var(--r-md)',
                background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                color: 'var(--text-1)', fontSize: 13, outline: 'none',
                fontFamily: 'var(--font-mono)',
              }} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.18em' }}>CONTRASEÑA</label>
                <a className="rl-mono" style={{ fontSize: 11, color: 'var(--cyan-400)', cursor: 'pointer' }}>¿Olvidaste?</a>
              </div>
              <input type="password" placeholder="••••••••" style={{
                width: '100%', padding: '12px 14px', borderRadius: 'var(--r-md)',
                background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                color: 'var(--text-1)', fontSize: 13, outline: 'none',
                fontFamily: 'var(--font-mono)',
              }} />
            </div>
            <button className="rl-mono rl-caps" style={{
              marginTop: 8,
              padding: '14px 18px', borderRadius: 'var(--r-md)',
              background: 'linear-gradient(135deg, var(--violet-600), var(--violet-700))',
              border: '1px solid var(--violet-500)',
              color: '#fff', fontSize: 12, letterSpacing: '0.16em',
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
              boxShadow: 'var(--glow-violet)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}>Acceder al radar {Icon.arrowR}</button>
          </div>

          <p className="rl-mono" style={{ marginTop: 24, fontSize: 11, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.6 }}>
            Al continuar aceptas los <a style={{ color: 'var(--text-2)', cursor: 'pointer' }}>términos</a> y <a style={{ color: 'var(--text-2)', cursor: 'pointer' }}>privacidad</a>.<br/>
            Datos públicos rastreados de fuentes oficiales.
          </p>
        </div>
      </div>
    </div>
  );
}

function Alertas() {
  const alertas = [
    { id: 1, name: 'Hemodiálisis IMSS', q: 'hemodiálisis OR diálisis · IMSS · cualquier estado', count: 12, last: 'hace 2h', kind: 'keyword', enabled: true },
    { id: 2, name: 'Construcción >$100M en CDMX', q: 'tipo:obra · estado:cmx · monto:>100M', count: 4, last: 'hace 5h', kind: 'monto', enabled: true },
    { id: 3, name: 'SEDENA armamento', q: 'SEDENA · "fuerzas armadas" OR armamento OR municion', count: 2, last: 'ayer', kind: 'keyword', enabled: true },
    { id: 4, name: 'Cierran en 48h', q: 'estado:activa · cierre:<48h', count: 38, last: 'hace 12min', kind: 'tiempo', enabled: true },
    { id: 5, name: 'CONAGUA infraestructura hídrica', q: 'CONAGUA · "canal" OR "presa" OR "acueducto"', count: 7, last: 'hace 1d', kind: 'keyword', enabled: false },
  ];

  return (
    <div className="rl-frame" style={{
      minHeight: 1080,
      background: `radial-gradient(900px 500px at 50% -10%, rgba(124,58,237,0.10), transparent 60%), var(--bg-0)`,
    }}>
      <TopNav active="alertas" />

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 0, minHeight: 'calc(1080px - 64px)' }}>
        {/* Left rail: profile */}
        <aside style={{ padding: 28, borderRight: '1px solid var(--line-1)' }}>
          <div style={{
            padding: 18, borderRadius: 'var(--r-lg)',
            background: 'linear-gradient(180deg, rgba(124,58,237,0.10), transparent)',
            border: '1px solid var(--line-1)', textAlign: 'center',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 999, margin: '0 auto 12px',
              background: 'linear-gradient(135deg, var(--violet-600), var(--cyan-500))',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 22, color: '#fff', fontWeight: 600,
              boxShadow: 'var(--glow-violet)',
            }}>KT</div>
            <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 500 }}>Kenneth Torres</div>
            <div className="rl-mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>kenneth@empresa.mx</div>
            <div className="rl-mono rl-caps" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginTop: 14, padding: '4px 10px', borderRadius: 'var(--r-pill)',
              background: 'rgba(217,70,239,0.10)', border: '1px solid rgba(217,70,239,0.30)',
              color: 'var(--magenta-400)', fontSize: 10, letterSpacing: '0.16em',
            }}>{Icon.sparkle} PRO · ILIMITADO</div>
          </div>

          <nav style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { l: 'Mis alertas', icon: Icon.bell, active: true, badge: 5 },
              { l: 'Favoritos', icon: Icon.star, badge: 23 },
              { l: 'Búsquedas guardadas', icon: Icon.search, badge: 8 },
              { l: 'Historial', icon: Icon.cal },
              { l: 'API & exports', icon: Icon.download },
              { l: 'Configuración', icon: Icon.user },
            ].map((it, i) => (
              <button key={i} className="rl-mono" style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 8, border: 'none',
                background: it.active ? 'rgba(124,58,237,0.15)' : 'transparent',
                color: it.active ? 'var(--violet-300)' : 'var(--text-2)',
                fontSize: 12, cursor: 'pointer', textAlign: 'left',
                fontFamily: 'var(--font-mono)',
              }}>
                <span style={{ color: it.active ? 'var(--violet-300)' : 'var(--text-3)' }}>{it.icon}</span>
                <span style={{ flex: 1 }}>{it.l}</span>
                {it.badge && (
                  <span style={{
                    padding: '1px 6px', borderRadius: 999,
                    background: it.active ? 'var(--violet-600)' : 'var(--bg-3)',
                    color: it.active ? '#fff' : 'var(--text-3)',
                    fontSize: 10, minWidth: 18, textAlign: 'center',
                  }}>{it.badge}</span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main */}
        <main style={{ padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
            <div>
              <h2 style={{
                margin: 0, fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600,
                color: 'var(--text-1)', letterSpacing: '-0.02em',
              }}>Mis alertas</h2>
              <p style={{ margin: '4px 0 0', color: 'var(--text-3)', fontSize: 13 }}>
                5 alertas activas · 63 oportunidades capturadas esta semana
              </p>
            </div>
            <button className="rl-mono rl-caps" style={{
              padding: '12px 16px', borderRadius: 'var(--r-md)',
              background: 'linear-gradient(135deg, var(--violet-600), var(--violet-700))',
              border: '1px solid var(--violet-500)',
              color: '#fff', fontSize: 11, letterSpacing: '0.14em',
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
              boxShadow: 'var(--glow-violet)',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>+ Nueva alerta</button>
          </div>

          {/* Channel strip */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
            {[
              { l: 'Email · kenneth@empresa.mx', on: true },
              { l: 'WhatsApp · +52', on: true },
              { l: 'Slack #licitaciones', on: false },
              { l: 'Webhook · API', on: true },
            ].map((c, i) => (
              <div key={i} style={{
                padding: '10px 14px', borderRadius: 'var(--r-pill)',
                background: c.on ? 'rgba(16,242,168,0.06)' : 'var(--bg-2)',
                border: `1px solid ${c.on ? 'rgba(16,242,168,0.30)' : 'var(--line-2)'}`,
                color: c.on ? 'var(--status-active)' : 'var(--text-3)',
                fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 8,
                fontFamily: 'var(--font-mono)',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: 999,
                  background: c.on ? 'var(--status-active)' : 'var(--text-4)',
                  boxShadow: c.on ? '0 0 6px var(--status-active)' : 'none',
                }} />
                {c.l}
              </div>
            ))}
          </div>

          {/* Alert cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {alertas.map(a => (
              <div key={a.id} style={{
                padding: 20, borderRadius: 'var(--r-lg)',
                background: 'var(--bg-2)', border: '1px solid var(--line-1)',
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'center',
                opacity: a.enabled ? 1 : 0.5,
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--text-1)' }}>
                      {a.name}
                    </h3>
                    <span className="rl-mono rl-caps" style={{
                      padding: '3px 8px', borderRadius: 'var(--r-pill)',
                      background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.25)',
                      color: 'var(--violet-300)', fontSize: 9, letterSpacing: '0.16em',
                    }}>{a.kind}</span>
                  </div>
                  <code className="rl-mono" style={{
                    display: 'inline-block', padding: '4px 8px', borderRadius: 4,
                    background: 'var(--bg-3)', color: 'var(--cyan-400)',
                    fontSize: 11, letterSpacing: '0.02em',
                  }}>{a.q}</code>
                  <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                    <span className="rl-mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      <span style={{ color: 'var(--status-active)', fontWeight: 600 }}>{a.count}</span> nuevas
                    </span>
                    <span className="rl-mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>último match: {a.last}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="rl-mono rl-caps" style={{
                    padding: '8px 12px', borderRadius: 6,
                    background: 'transparent', border: '1px solid var(--line-2)',
                    color: 'var(--text-2)', fontSize: 10, letterSpacing: '0.14em', cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                  }}>Ver matches</button>
                  <button style={{
                    width: 36, height: 36, borderRadius: 8, border: '1px solid var(--line-2)',
                    background: 'var(--bg-3)', color: 'var(--text-2)', cursor: 'pointer',
                  }}>⋯</button>
                  {/* Toggle */}
                  <div style={{
                    width: 40, height: 22, borderRadius: 999, padding: 2,
                    background: a.enabled ? 'var(--violet-600)' : 'var(--bg-3)',
                    cursor: 'pointer', transition: 'all .2s',
                    boxShadow: a.enabled ? '0 0 8px var(--violet-glow)' : 'none',
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: 999,
                      background: '#fff',
                      transform: a.enabled ? 'translateX(18px)' : 'translateX(0)',
                      transition: 'transform .2s',
                    }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

window.Login = Login;
window.Alertas = Alertas;
