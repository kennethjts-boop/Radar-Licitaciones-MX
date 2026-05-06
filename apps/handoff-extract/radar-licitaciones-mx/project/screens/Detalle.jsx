// Detalle de licitación — vista expandida con timeline + datos + acciones

function Detalle() {
  const data = window.RL_DATA;
  const lic = data.licitaciones[3]; // hemodiálisis Tabasco $96.5M

  const timeline = [
    { date: '28 abr 2026', label: 'Convocatoria publicada', state: 'done' },
    { date: '03 may 2026', label: 'Junta de aclaraciones', state: 'done' },
    { date: '12 may 2026', label: 'Recepción de propuestas', state: 'active' },
    { date: '20 may 2026', label: 'Cierre y apertura técnica', state: 'pending' },
    { date: '28 may 2026', label: 'Fallo y adjudicación', state: 'pending' },
  ];

  return (
    <div className="rl-frame" style={{
      minHeight: 1080,
      background: `radial-gradient(900px 500px at 50% -10%, rgba(124,58,237,0.10), transparent 60%), var(--bg-0)`,
    }}>
      <TopNav active="dashboard" />

      {/* Breadcrumb */}
      <div style={{
        padding: '14px 28px', borderBottom: '1px solid var(--line-1)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.14em' }}>
          Radar / IMSS / Tabasco /
        </span>
        <span className="rl-mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
          {lic.id}
        </span>
        <div style={{ flex: 1 }} />
        <button className="rl-mono rl-caps" style={{
          padding: '7px 12px', borderRadius: 6, background: 'transparent',
          border: '1px solid var(--line-2)', color: 'var(--text-2)',
          fontSize: 10, letterSpacing: '0.14em', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--font-mono)',
        }}>← Volver al radar</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 0 }}>
        {/* Main */}
        <div style={{ padding: '32px 28px', borderRight: '1px solid var(--line-1)' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <StatusPill status="activa" />
                <EstadoChip code="TAB" name="Tabasco" />
                <span className="rl-mono rl-caps" style={{
                  padding: '4px 8px', borderRadius: 'var(--r-pill)',
                  background: 'rgba(34,211,238,0.10)', border: '1px solid rgba(34,211,238,0.30)',
                  color: 'var(--cyan-400)', fontSize: 10, letterSpacing: '0.14em',
                }}>SERVICIOS · LP-NACIONAL</span>
              </div>
              <h1 style={{
                margin: 0, fontFamily: 'var(--font-display)', fontSize: 32,
                fontWeight: 600, lineHeight: 1.15, color: 'var(--text-1)',
                letterSpacing: '-0.02em', textWrap: 'balance',
              }}>
                {lic.titulo}
              </h1>
              <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
                <div>
                  <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 4 }}>NUC</div>
                  <div className="rl-mono" style={{ fontSize: 13, color: 'var(--text-1)' }}>{lic.id}</div>
                </div>
                <div>
                  <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 4 }}>Dependencia</div>
                  <div style={{ fontSize: 13, color: 'var(--text-1)' }}>{lic.dep} · Delegación Tabasco</div>
                </div>
                <div>
                  <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 4 }}>Fuente</div>
                  <div style={{ fontSize: 13, color: 'var(--text-1)' }}>CompraNet · 05 may 26</div>
                </div>
              </div>
            </div>
          </div>

          {/* Big numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
            {[
              { label: 'Monto estimado', value: '$96.5M', sub: 'MXN · referencia', color: 'var(--text-1)' },
              { label: 'Cierra en', value: '15 días', sub: '20 may · 17:00', color: 'var(--status-closing)' },
              { label: 'Ofertas recibidas', value: '9', sub: 'de ~14 esperadas', color: 'var(--cyan-400)' },
              { label: 'Score Radar', value: '8.4', sub: 'oportunidad alta', color: 'var(--violet-400)' },
            ].map((s, i) => (
              <div key={i} style={{
                padding: 16, borderRadius: 'var(--r-md)',
                background: 'var(--bg-2)', border: '1px solid var(--line-1)',
              }}>
                <div className="rl-mono rl-caps" style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em', marginBottom: 8 }}>{s.label}</div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 600,
                  color: s.color, letterSpacing: '-0.01em', lineHeight: 1,
                }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Timeline */}
          <h3 style={{ margin: '0 0 16px', fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-1)', fontWeight: 600 }}>
            Cronograma del proceso
          </h3>
          <div style={{
            padding: 24, borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)', border: '1px solid var(--line-1)',
            marginBottom: 32,
          }}>
            <div style={{ position: 'relative' }}>
              {/* Track */}
              <div style={{
                position: 'absolute', left: 8, top: 8, bottom: 8, width: 1,
                background: 'var(--line-2)',
              }} />
              {timeline.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 16, padding: '10px 0', position: 'relative' }}>
                  <div style={{
                    width: 17, height: 17, borderRadius: 999, marginTop: 2,
                    background: t.state === 'done' ? 'var(--status-active)' : t.state === 'active' ? 'var(--cyan-400)' : 'var(--bg-3)',
                    border: t.state === 'pending' ? '1px solid var(--line-2)' : 'none',
                    boxShadow: t.state === 'active' ? '0 0 12px var(--cyan-400)' : 'none',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, position: 'relative', zIndex: 1,
                    color: '#06070C',
                  }}>
                    {t.state === 'done' && Icon.check}
                    {t.state === 'active' && (
                      <span style={{
                        width: 7, height: 7, borderRadius: 999, background: '#06070C',
                        animation: 'rl-pulse 1.4s ease-in-out infinite',
                      }} />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 500 }}>{t.label}</div>
                    <div className="rl-mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{t.date}</div>
                  </div>
                  {t.state === 'active' && (
                    <span className="rl-mono rl-caps" style={{
                      padding: '3px 8px', borderRadius: 'var(--r-pill)',
                      background: 'var(--status-new-bg)', color: 'var(--cyan-400)',
                      border: '1px solid rgba(34,211,238,0.30)',
                      fontSize: 9, letterSpacing: '0.14em', height: 'fit-content',
                    }}>FASE ACTUAL</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Resumen / análisis */}
          <h3 style={{ margin: '0 0 16px', fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-1)', fontWeight: 600 }}>
            Análisis Radar <span className="rl-mono rl-caps" style={{ fontSize: 10, color: 'var(--violet-400)', letterSpacing: '0.16em', marginLeft: 8 }}>◉ AI</span>
          </h3>
          <div style={{
            padding: 20, borderRadius: 'var(--r-lg)',
            background: 'linear-gradient(180deg, rgba(124,58,237,0.06), rgba(6,182,212,0.03))',
            border: '1px solid rgba(124,58,237,0.25)',
            marginBottom: 24,
          }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--text-2)' }}>
              Esta licitación continúa el contrato HD-2025-TAB-IMSS adjudicado el año pasado a Diaverum
              México por <span className="rl-mono" style={{ color: 'var(--text-1)' }}>$87.3M</span>. El monto incrementa <span style={{ color: 'var(--status-active)' }}>+10.5%</span>,
              consistente con la inflación médica. Históricamente <span className="rl-mono" style={{ color: 'var(--text-1)' }}>3 de 9</span> ofertas
              suelen pasar la evaluación técnica.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              {['Compitencia media', 'Reincidente IMSS', 'Sector salud', 'Pago a 30 días'].map(t => (
                <span key={t} className="rl-mono" style={{
                  padding: '4px 10px', borderRadius: 'var(--r-pill)',
                  background: 'var(--bg-3)', border: '1px solid var(--line-2)',
                  fontSize: 10, color: 'var(--text-2)',
                }}>{t}</span>
              ))}
            </div>
          </div>

          {/* Documentos */}
          <h3 style={{ margin: '0 0 16px', fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-1)', fontWeight: 600 }}>
            Documentos
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {[
              { name: 'Convocatoria.pdf', size: '2.4 MB' },
              { name: 'Anexo_Tecnico.pdf', size: '8.1 MB' },
              { name: 'Bases_Administrativas.pdf', size: '1.2 MB' },
              { name: 'Acta_Aclaraciones.pdf', size: '420 KB' },
            ].map(d => (
              <div key={d.name} style={{
                padding: 14, borderRadius: 'var(--r-md)',
                background: 'var(--bg-2)', border: '1px solid var(--line-1)',
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 6,
                  background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.30)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--violet-300)',
                }}>{Icon.doc}</div>
                <div style={{ flex: 1 }}>
                  <div className="rl-mono" style={{ fontSize: 12, color: 'var(--text-1)' }}>{d.name}</div>
                  <div className="rl-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{d.size}</div>
                </div>
                <span style={{ color: 'var(--text-3)' }}>{Icon.download}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <aside style={{ padding: 24 }}>
          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            <button className="rl-mono rl-caps" style={{
              padding: '14px 18px', borderRadius: 'var(--r-md)',
              background: 'linear-gradient(135deg, var(--violet-600), var(--violet-700))',
              border: '1px solid var(--violet-500)',
              color: '#fff', fontSize: 11, letterSpacing: '0.16em',
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
              boxShadow: 'var(--glow-violet)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}>{Icon.bell} Crear alerta</button>
            <button className="rl-mono rl-caps" style={{
              padding: '12px 18px', borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              color: 'var(--text-1)', fontSize: 11, letterSpacing: '0.16em',
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}>{Icon.star} Guardar</button>
            <button className="rl-mono rl-caps" style={{
              padding: '12px 18px', borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              color: 'var(--text-1)', fontSize: 11, letterSpacing: '0.16em',
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}>{Icon.ext} Ver en CompraNet</button>
          </div>

          {/* Datos rápidos */}
          <div style={{
            padding: 18, borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)', border: '1px solid var(--line-1)',
            marginBottom: 16,
          }}>
            <h4 className="rl-mono rl-caps" style={{
              margin: '0 0 14px', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.18em', fontWeight: 600,
            }}>◉ Ficha técnica</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['Tipo', 'Licitación pública nacional'],
                ['Carácter', 'Servicios'],
                ['Forma', 'Electrónica'],
                ['Modalidad', 'Precios fijos'],
                ['Plazo', '184 días'],
                ['Garantía', '10% del monto'],
                ['Anticipo', 'No aplica'],
                ['Visita', 'Opcional · 08 may'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                  <span className="rl-mono rl-caps" style={{ color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.12em' }}>{k}</span>
                  <span style={{ color: 'var(--text-1)', textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Histórico */}
          <div style={{
            padding: 18, borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)', border: '1px solid var(--line-1)',
          }}>
            <h4 className="rl-mono rl-caps" style={{
              margin: '0 0 14px', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.18em', fontWeight: 600,
            }}>◉ Adjudicaciones previas</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { year: '2025', empresa: 'Diaverum México', monto: '$87.3M' },
                { year: '2024', empresa: 'Diaverum México', monto: '$79.8M' },
                { year: '2023', empresa: 'Fresenius Medical', monto: '$72.1M' },
              ].map(h => (
                <div key={h.year} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid var(--line-1)', gap: 8,
                }}>
                  <span className="rl-mono" style={{ fontSize: 11, color: 'var(--violet-300)' }}>{h.year}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-1)', flex: 1, marginLeft: 10 }}>{h.empresa}</span>
                  <span className="rl-mono" style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 500 }}>{h.monto}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

window.Detalle = Detalle;
