// Mapa de México con licitaciones por estado (estilizado, no geográfico exacto)

function Mapa() {
  const data = window.RL_DATA;
  const [hover, setHover] = React.useState(null);
  const [selected, setSelected] = React.useState('CMX');

  // Posiciones aproximadas de estados (no geográfico real, layout decorativo)
  const positions = {
    BCN: { x: 60, y: 90, r: 14 }, BCS: { x: 110, y: 200, r: 12 },
    SON: { x: 180, y: 150, r: 16 }, SIN: { x: 230, y: 220, r: 13 },
    CHH: { x: 260, y: 130, r: 18 }, COA: { x: 340, y: 170, r: 14 },
    NLE: { x: 400, y: 200, r: 17 }, TAM: { x: 460, y: 230, r: 13 },
    DUR: { x: 290, y: 230, r: 12 }, ZAC: { x: 340, y: 260, r: 11 },
    NAY: { x: 280, y: 290, r: 9 }, JAL: { x: 320, y: 320, r: 16 },
    AGU: { x: 350, y: 290, r: 8 }, GUA: { x: 380, y: 320, r: 11 },
    SLP: { x: 390, y: 270, r: 12 }, QRO: { x: 410, y: 340, r: 10 },
    HID: { x: 440, y: 340, r: 11 }, MIC: { x: 360, y: 370, r: 13 },
    COL: { x: 320, y: 370, r: 8 }, MEX: { x: 430, y: 380, r: 11 },
    CMX: { x: 445, y: 388, r: 14 }, MOR: { x: 440, y: 410, r: 9 },
    PUE: { x: 470, y: 380, r: 13 }, TLA: { x: 458, y: 370, r: 7 },
    GUE: { x: 410, y: 430, r: 13 }, OAX: { x: 470, y: 440, r: 14 },
    VER: { x: 490, y: 360, r: 16 }, TAB: { x: 530, y: 410, r: 12 },
    CHP: { x: 540, y: 460, r: 15 }, CAM: { x: 580, y: 380, r: 12 },
    YUC: { x: 620, y: 350, r: 12 }, ROO: { x: 650, y: 380, r: 12 },
  };

  const stateData = {
    CMX: { count: 1842, monto: 24.1, change: 12 },
    NLE: { count: 587, monto: 9.12, change: 8 },
    JAL: { count: 612, monto: 8.4, change: -3 },
    OAX: { count: 421, monto: 3.8, change: 22 },
    TAB: { count: 298, monto: 4.2, change: 18 },
    DUR: { count: 187, monto: 1.9, change: 5 },
    ROO: { count: 234, monto: 2.7, change: 14 },
    VER: { count: 367, monto: 5.8, change: 9 },
    CHH: { count: 312, monto: 4.9, change: -2 },
    YUC: { count: 198, monto: 2.1, change: 11 },
  };

  const sel = stateData[selected] || stateData.CMX;
  const selName = data.estados.find(e => e.code === selected)?.name || 'Ciudad de México';

  return (
    <div className="rl-frame" style={{
      minHeight: 1080,
      background: `radial-gradient(900px 500px at 50% 30%, rgba(124,58,237,0.10), transparent 60%), var(--bg-0)`,
    }}>
      <TopNav active="mapa" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 0, minHeight: 'calc(1080px - 64px)' }}>
        {/* Map */}
        <div style={{ position: 'relative', padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h2 style={{
                margin: 0, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600,
                color: 'var(--text-1)', letterSpacing: '-0.02em',
              }}>Mapa nacional de licitaciones</h2>
              <p style={{ margin: '4px 0 0', color: 'var(--text-3)', fontSize: 13 }}>
                Concentración por estado · click para inspeccionar
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {[
                ['Por monto', 'var(--violet-400)'],
                ['Por cantidad', 'var(--text-3)'],
                ['Por crecimiento', 'var(--text-3)'],
              ].map(([label, c], i) => (
                <button key={i} className="rl-mono rl-caps" style={{
                  padding: '8px 12px', borderRadius: 6,
                  background: i === 0 ? 'rgba(124,58,237,0.15)' : 'transparent',
                  border: `1px solid ${i === 0 ? 'rgba(124,58,237,0.30)' : 'var(--line-2)'}`,
                  color: c, fontSize: 10, letterSpacing: '0.14em',
                  cursor: 'pointer', fontFamily: 'var(--font-mono)',
                }}>{label}</button>
              ))}
            </div>
          </div>

          <div style={{
            position: 'relative', borderRadius: 'var(--r-lg)',
            background: `
              radial-gradient(600px 400px at 60% 60%, rgba(124,58,237,0.08), transparent 60%),
              var(--bg-1)
            `,
            border: '1px solid var(--line-1)',
            overflow: 'hidden',
            aspectRatio: '720 / 560',
          }}>
            {/* Grid */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0, opacity: 0.4,
              backgroundImage: `linear-gradient(rgba(124,58,237,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.06) 1px, transparent 1px)`,
              backgroundSize: '32px 32px',
            }} />

            {/* Compass */}
            <div className="rl-mono rl-caps" style={{
              position: 'absolute', top: 16, left: 16,
              fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.18em',
            }}>◉ MX · LAT 19.43 · LON -99.13</div>
            <div className="rl-mono" style={{
              position: 'absolute', top: 16, right: 16,
              fontSize: 10, color: 'var(--cyan-400)', letterSpacing: '0.10em',
            }}>SCALE 1:5.4M · 32/32 ESTADOS</div>

            <svg viewBox="0 0 720 560" style={{ width: '100%', height: '100%', display: 'block' }}>
              <defs>
                <radialGradient id="state-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Ghost outline (stylized) */}
              <path d="M 60 110 L 100 90 L 200 130 L 310 130 L 380 175 L 470 220 L 540 250 L 600 290 L 660 340 L 690 380 L 660 420 L 600 470 L 540 490 L 470 470 L 410 460 L 350 440 L 280 410 L 220 380 L 170 340 L 130 290 L 100 240 L 90 200 L 80 170 Z"
                fill="rgba(124,58,237,0.04)" stroke="rgba(124,58,237,0.18)" strokeWidth="1" strokeDasharray="3 4" />

              {/* Connection lines from CDMX */}
              {Object.entries(positions).map(([code, p]) => {
                if (code === 'CMX') return null;
                const sd = stateData[code];
                if (!sd) return null;
                const cmx = positions.CMX;
                return (
                  <line key={`l-${code}`} x1={cmx.x} y1={cmx.y} x2={p.x} y2={p.y}
                    stroke="rgba(124,58,237,0.10)" strokeWidth="0.5" />
                );
              })}

              {/* States */}
              {Object.entries(positions).map(([code, p]) => {
                const sd = stateData[code];
                const has = !!sd;
                const isSel = selected === code;
                const isHover = hover === code;
                return (
                  <g key={code} style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHover(code)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(code)}>
                    {/* Glow */}
                    {has && (
                      <circle cx={p.x} cy={p.y} r={p.r * 2.4}
                        fill="url(#state-glow)" opacity={isSel ? 0.9 : isHover ? 0.6 : 0.35} />
                    )}
                    {/* Pulse ring on selected */}
                    {isSel && (
                      <circle cx={p.x} cy={p.y} r={p.r * 1.8} fill="none"
                        stroke="var(--cyan-400)" strokeWidth="1" opacity="0.6"
                        style={{ transformOrigin: `${p.x}px ${p.y}px`, animation: 'rl-pulse 1.6s ease-out infinite' }} />
                    )}
                    {/* Bubble */}
                    <circle cx={p.x} cy={p.y} r={p.r}
                      fill={has ? (isSel ? 'var(--cyan-400)' : 'var(--violet-500)') : 'var(--bg-3)'}
                      stroke={isSel ? 'var(--cyan-300)' : has ? 'var(--violet-300)' : 'var(--line-2)'}
                      strokeWidth={isSel ? 2 : 1}
                      opacity={has ? 0.85 : 0.40}
                      style={{
                        filter: isSel ? 'drop-shadow(0 0 12px var(--cyan-400))' : has ? `drop-shadow(0 0 6px var(--violet-500))` : 'none',
                        transition: 'all .2s',
                      }}
                    />
                    {/* Code */}
                    <text x={p.x} y={p.y + 3} textAnchor="middle"
                      fontFamily="JetBrains Mono" fontSize={p.r > 12 ? '9' : '7'}
                      fontWeight="600" fill={has ? '#06070C' : 'var(--text-3)'}
                      letterSpacing="0.5" style={{ pointerEvents: 'none' }}>{code}</text>
                    {/* Label below */}
                    {(isSel || isHover) && (
                      <g style={{ pointerEvents: 'none' }}>
                        <rect x={p.x - 50} y={p.y + p.r + 6} width="100" height="38" rx="4"
                          fill="rgba(11,14,24,0.95)" stroke="rgba(34,211,238,0.40)" strokeWidth="1" />
                        <text x={p.x} y={p.y + p.r + 20} textAnchor="middle"
                          fontFamily="JetBrains Mono" fontSize="9" fill="var(--cyan-400)" letterSpacing="1.5">
                          {data.estados.find(e => e.code === code)?.name?.toUpperCase() || code}
                        </text>
                        <text x={p.x} y={p.y + p.r + 34} textAnchor="middle"
                          fontFamily="JetBrains Mono" fontSize="11" fill="var(--text-1)" fontWeight="600">
                          {sd ? `$${sd.monto}B · ${sd.count}` : 'Sin datos'}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Legend */}
            <div style={{
              position: 'absolute', bottom: 16, left: 16,
              padding: '12px 14px', borderRadius: 'var(--r-md)',
              background: 'rgba(6,7,12,0.85)', backdropFilter: 'blur(8px)',
              border: '1px solid var(--line-2)',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em' }}>Monto</div>
              {[
                { c: 'rgba(124,58,237,0.4)', l: '<$2B' },
                { c: 'rgba(124,58,237,0.7)', l: '$2-5B' },
                { c: 'var(--violet-500)', l: '$5-10B' },
                { c: 'var(--cyan-400)', l: '>$10B' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: s.c, boxShadow: `0 0 4px ${s.c}` }} />
                  <span className="rl-mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>{s.l}</span>
                </div>
              ))}
            </div>

            {/* Live blip */}
            <div style={{
              position: 'absolute', bottom: 16, right: 16,
              padding: '10px 14px', borderRadius: 'var(--r-pill)',
              background: 'rgba(16,242,168,0.10)', border: '1px solid rgba(16,242,168,0.30)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: 999, background: 'var(--status-active)',
                boxShadow: '0 0 8px var(--status-active)',
                animation: 'rl-pulse 1.4s ease-in-out infinite',
              }} />
              <span className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--status-active)', letterSpacing: '0.16em' }}>
                LIVE · 142 hoy
              </span>
            </div>
          </div>

          {/* Bottom strip: top estados bar chart */}
          <div style={{ marginTop: 20 }}>
            <div className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 12 }}>
              ◉ Top 10 estados · monto total 2026
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
              {data.estados.slice().sort((a, b) => b.monto - a.monto).map((e, i) => {
                const max = Math.max(...data.estados.map(x => x.monto));
                const h = (e.monto / max) * 100;
                const isSel = selected === e.code;
                return (
                  <div key={e.code} onClick={() => setSelected(e.code)} style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    cursor: 'pointer',
                  }}>
                    <span className="rl-mono" style={{
                      fontSize: 10, color: isSel ? 'var(--cyan-400)' : 'var(--text-2)', fontWeight: 600,
                    }}>${e.monto / 1e9}B</span>
                    <div style={{
                      width: '100%', height: `${h}%`, minHeight: 4,
                      background: isSel
                        ? 'linear-gradient(180deg, var(--cyan-400), var(--violet-500))'
                        : 'linear-gradient(180deg, var(--violet-500), var(--violet-700))',
                      borderRadius: '4px 4px 0 0',
                      boxShadow: isSel ? '0 0 12px var(--cyan-400)' : 'none',
                    }} />
                    <span className="rl-mono" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.06em' }}>{e.code}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sidebar: details */}
        <aside style={{ padding: 24, borderLeft: '1px solid var(--line-1)', background: 'rgba(11,14,24,0.4)' }}>
          <div className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.18em', marginBottom: 8 }}>
            ◉ Estado seleccionado
          </div>
          <h2 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600,
            color: 'var(--text-1)', letterSpacing: '-0.02em',
          }}>{selName}</h2>
          <div className="rl-mono" style={{ fontSize: 11, color: 'var(--cyan-400)', letterSpacing: '0.06em', marginTop: 4 }}>
            {selected} · GMT-6 · Centro
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 24 }}>
            <div style={{
              padding: 14, borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)', border: '1px solid var(--line-1)',
            }}>
              <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 6 }}>Licitaciones</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>{sel.count.toLocaleString('es-MX')}</div>
            </div>
            <div style={{
              padding: 14, borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)', border: '1px solid var(--line-1)',
            }}>
              <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 6 }}>Monto Σ</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--cyan-400)', fontWeight: 600 }}>${sel.monto}B</div>
            </div>
            <div style={{
              padding: 14, borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)', border: '1px solid var(--line-1)',
            }}>
              <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 6 }}>Δ vs mes</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: sel.change >= 0 ? 'var(--status-active)' : 'var(--status-alert)', fontWeight: 600 }}>{sel.change >= 0 ? '+' : ''}{sel.change}%</div>
            </div>
            <div style={{
              padding: 14, borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)', border: '1px solid var(--line-1)',
            }}>
              <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 6 }}>Activas</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>{Math.floor(sel.count * 0.32)}</div>
            </div>
          </div>

          {/* Top dependencias */}
          <h4 className="rl-mono rl-caps" style={{
            margin: '24px 0 12px', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.18em', fontWeight: 600,
          }}>◉ Dependencias activas</h4>
          {[
            { n: 'IMSS', c: 412, p: 100 },
            { n: 'CFE', c: 287, p: 70 },
            { n: 'PEMEX', c: 198, p: 48 },
            { n: 'SEDENA', c: 156, p: 38 },
            { n: 'CONAGUA', c: 124, p: 30 },
          ].map(d => (
            <div key={d.n} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: 'var(--text-1)' }}>{d.n}</span>
                <span className="rl-mono" style={{ color: 'var(--text-3)' }}>{d.c}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-3)', overflow: 'hidden' }}>
                <div style={{
                  width: `${d.p}%`, height: '100%',
                  background: 'linear-gradient(90deg, var(--violet-500), var(--cyan-400))',
                  boxShadow: '0 0 6px var(--violet-500)',
                }} />
              </div>
            </div>
          ))}

          <button className="rl-mono rl-caps" style={{
            marginTop: 20, width: '100%',
            padding: '12px 14px', borderRadius: 'var(--r-md)',
            background: 'linear-gradient(135deg, var(--violet-600), var(--violet-700))',
            border: '1px solid var(--violet-500)',
            color: '#fff', fontSize: 11, letterSpacing: '0.16em',
            cursor: 'pointer', fontFamily: 'var(--font-mono)',
            boxShadow: 'var(--glow-violet)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>Ver {sel.count} licitaciones {Icon.arrowR}</button>
        </aside>
      </div>
    </div>
  );
}

window.Mapa = Mapa;
