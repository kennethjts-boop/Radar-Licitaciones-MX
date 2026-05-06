import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { Search, Building, X, Zap, Coins, LogIn, CheckCircle2, MapPin, ChevronRight, Sparkles, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Procurement {
  id: string;
  title: string;
  status: string;
  dependency_name: string | null;
  licitation_number: string | null;
  opening_date: string | null;
  publication_date: string | null;
  amount: number | null;
  currency: string | null;
  url: string | null;
  state: string | null;
  created_at: string;
}

interface User {
  email: string;
  role: 'admin' | 'user' | 'guest';
  tokens: number;
}

interface AnalysisResult {
  resumen_ejecutivo: string;
  veredicto: string;
  score_oportunidad: number;
  probabilidad_exito: number;
  puntos_clave: string[];
  riesgos_detectados: string[];
  tips_ganadores: string[];
  analisis_tecnico: string;
  analisis_economico: string;
}

export default function App() {
  const [procurements, setProcurements] = useState<Procurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterState, setFilterState] = useState('');
  const [selected, setSelected] = useState<Procurement | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({});

  useEffect(() => {
    fetchProcurements();
    const saved = localStorage.getItem('radar_user');
    if (saved) setUser(JSON.parse(saved));
  }, []);

  const fetchProcurements = async () => {
    try {
      const { data, error } = await supabase
        .from('procurements').select('*')
        .order('created_at', { ascending: false }).limit(120);
      if (error) throw error;
      setProcurements(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault(); setAuthLoading(true);
    setTimeout(() => {
      const role = email === 'admin@radar.com' ? 'admin' : 'user';
      const u: User = { email, role, tokens: role === 'admin' ? 999999 : 50 };
      setUser(u); localStorage.setItem('radar_user', JSON.stringify(u)); setAuthLoading(false);
    }, 900);
  };

  const handleGuestLogin = () => {
    const u: User = { email: 'invitado@demo.com', role: 'guest', tokens: 0 };
    setUser(u);
  };

  const handleLogout = () => { setUser(null); localStorage.removeItem('radar_user'); };

  const generateAnalysis = async (p: Procurement) => {
    if (user?.tokens === 0 && user.role !== 'admin') {
      alert("Sin tokens. Recarga tu cuenta."); return;
    }
    setAnalyzing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-procurement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ procurementId: p.id })
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error'); }
      const analysis: AnalysisResult = await res.json();
      setAnalyses(prev => ({ ...prev, [p.id]: analysis }));
      if (user && user.role !== 'admin') {
        const u = { ...user, tokens: user.tokens - 10 };
        setUser(u); localStorage.setItem('radar_user', JSON.stringify(u));
      }
    } catch (e: any) { alert(`Error: ${e.message}`); }
    finally { setAnalyzing(false); }
  };

  const filtered = procurements.filter(p => {
    const s = p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
              p.licitation_number?.toLowerCase().includes(searchTerm.toLowerCase());
    const st = filterState ? p.state === filterState : true;
    return s && st;
  });

  const uniqueStates = Array.from(new Set(procurements.map(p => p.state).filter(Boolean))) as string[];

  const fmtDate = (d: string | null) => {
    if (!d) return 'N/D';
    try { return format(new Date(d), 'dd MMM yyyy', { locale: es }); } catch { return d; }
  };

  const badgeClass = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('activ') || s.includes('vigent') || s.includes('publicad')) return 'badge-active';
    if (s.includes('desiert') || s.includes('cancel')) return 'badge-danger';
    if (s.includes('evalua') || s.includes('fallo')) return 'badge-warning';
    return 'badge-neutral';
  };

  /* ── LOGIN ── */
  if (!user) return (
    <div className="login-page">
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />
      <div className="login-card">
        <div className="flex justify-center mb-8">
          <div className="logo-icon" style={{ width: 72, height: 72, borderRadius: 22 }}>
            <Sparkles size={36} />
          </div>
        </div>
        <h1 style={{ fontSize: '2.4rem', textAlign: 'center', marginBottom: '0.5rem' }}>Radar OSINT</h1>
        <p style={{ textAlign: 'center', color: 'var(--text-3)', marginBottom: '3rem', fontSize: '1rem' }}>Inteligencia estratégica para licitaciones públicas de México</p>

        <form onSubmit={handleLogin} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="input-label">Correo</label>
            <input type="email" required className="input-field" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@radar.com" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="input-label">Contraseña</label>
            <input type="password" required className="input-field" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button type="submit" className="btn btn-gradient" style={{ width: '100%', padding: '1rem', fontSize: '1rem', marginTop: '0.5rem' }} disabled={authLoading}>
            {authLoading ? <div className="loader-ring" style={{ width: 22, height: 22, borderWidth: 3 }} /> : <><Sparkles size={18} /> Entrar al Radar</>}
          </button>
        </form>

        <div className="divider" />
        <button onClick={handleGuestLogin} className="btn btn-ghost" style={{ width: '100%', padding: '0.9rem' }}>
          Explorar como Invitado
        </button>
        <div style={{ marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'rgba(59,130,246,0.04)', borderRadius: 14, border: '1px solid rgba(59,130,246,0.1)', fontSize: '0.82rem', color: 'var(--text-3)' }}>
          <strong style={{ color: 'var(--blue)' }}>Admin demo:</strong> admin@radar.com / admin123
        </div>
      </div>
    </div>
  );

  /* ── MAIN DASHBOARD ── */
  return (
    <>
      <div className="animated-bg" />

      <header className="header">
        <div className="container flex justify-between items-center">
          <div className="logo-wrap">
            <div className="logo-icon"><Sparkles size={22} /></div>
            <span className="logo-name">Radar OSINT</span>
            <span className="logo-badge">PRO</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="token-chip">
              <Coins size={14} />
              <span>{user.role === 'admin' ? '∞ ILIMITADO' : `${user.tokens} TOKENS`}</span>
            </div>
            <button className="btn btn-ghost btn-icon" onClick={handleLogout} title="Salir">
              <LogIn size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="container" style={{ paddingTop: '3rem', paddingBottom: '6rem' }}>
        {/* Search row */}
        <div className="flex items-center gap-4 mb-12">
          <div className="search-wrap">
            <Search size={20} color="var(--text-3)" />
            <input className="search-input" placeholder="Buscar licitación, dependencia, expediente..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <select className="select-styled" value={filterState} onChange={e => setFilterState(e.target.value)}>
            <option value="">Todos los Estados</option>
            {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '8rem 0' }}>
            <div className="loader-ring" style={{ width: 56, height: 56, borderWidth: 5 }} />
            <p style={{ marginTop: '2rem', color: 'var(--text-3)', fontWeight: 600 }}>Sincronizando base de datos nacional...</p>
          </div>
        ) : (
          <div className="grid xl:grid-cols-4 lg:grid-cols-3 sm:grid-cols-2 grid-cols-1" style={{ gap: '1.5rem' }}>
            {filtered.map((p, i) => (
              <div
                key={p.id}
                className={`card anim-in ${analyses[p.id] ? 'card-glow' : ''}`}
                style={{ animationDelay: `${Math.min(i * 0.04, 0.8)}s` }}
                onClick={() => setSelected(p)}
              >
                <div className="flex justify-between items-center mb-4">
                  <span className={`badge ${badgeClass(p.status)}`}>{p.status}</span>
                  <span className="date-chip">{fmtDate(p.created_at)}</span>
                </div>

                <h3 className="card-title">{p.title}</h3>

                <div className="flex flex-col gap-2 mb-6">
                  <div className="card-meta"><Building size={13} />{p.dependency_name || 'Sin dependencia'}</div>
                  <div className="card-meta"><MapPin size={13} />{p.state || 'Nacional'}</div>
                </div>

                <div className="mt-auto" style={{ paddingTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 2 }}>Monto</div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)' }}>
                      {p.amount ? `$${p.amount.toLocaleString()}` : 'Abierto'}
                    </div>
                  </div>
                  {analyses[p.id]
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--emerald)', fontSize: '0.8rem', fontWeight: 800 }}><Zap size={16} fill="currentColor" /> IA</div>
                    : <ChevronRight size={20} color="var(--text-3)" />
                  }
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Detail Panel */}
      {selected && (
        <div className="panel-backdrop" onClick={() => setSelected(null)}>
          <div className="panel" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <span className={`badge ${badgeClass(selected.status)}`}>{selected.status}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setSelected(null)}><X size={20} /></button>
            </div>

            <div className="panel-body">
              <h1 style={{ fontSize: '1.75rem', lineHeight: 1.25, marginBottom: '2rem' }}>{selected.title}</h1>

              <div className="detail-grid">
                <div className="detail-box">
                  <div className="detail-label">Dependencia</div>
                  <div className="detail-value">{selected.dependency_name || 'N/D'}</div>
                </div>
                <div className="detail-box">
                  <div className="detail-label">Estado</div>
                  <div className="detail-value">{selected.state || 'México'}</div>
                </div>
                <div className="detail-box">
                  <div className="detail-label">Detectada por Radar</div>
                  <div className="detail-value" style={{ color: 'var(--blue)' }}>{fmtDate(selected.created_at)}</div>
                </div>
                <div className="detail-box">
                  <div className="detail-label">Monto Referencia</div>
                  <div className="detail-value">{selected.amount ? `$${selected.amount.toLocaleString()} ${selected.currency || 'MXN'}` : 'Abierto'}</div>
                </div>
                {selected.licitation_number && (
                  <div className="detail-box" style={{ gridColumn: 'span 2' }}>
                    <div className="detail-label">Número de Licitación</div>
                    <div className="detail-value" style={{ fontFamily: 'monospace' }}>{selected.licitation_number}</div>
                  </div>
                )}
              </div>

              {selected.url && (
                <a href={selected.url} target="_blank" rel="noopener noreferrer"
                  className="btn btn-ghost" style={{ marginBottom: '2.5rem', width: '100%' }}>
                  Ver Convocatoria Oficial ↗
                </a>
              )}

              {/* AI SECTION */}
              {analyses[selected.id] ? (
                <div className="ai-result">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', position: 'relative' }}>
                    <div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', marginBottom: '0.5rem' }}>Análisis Experto IA</div>
                      <h2 style={{ fontSize: '1.4rem' }}>{analyses[selected.id].veredicto?.replace(/_/g, ' ')}</h2>
                    </div>
                    <div className="logo-icon" style={{ background: 'rgba(255,255,255,0.08)', boxShadow: 'none', flexShrink: 0, animation: 'none' }}>
                      <Zap size={22} color="var(--blue)" />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', position: 'relative' }}>
                    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: 20 }}>
                      <div className="ai-score-label">Score de Oportunidad</div>
                      <div className="ai-score-big" style={{ color: analyses[selected.id].score_oportunidad > 65 ? '#34d399' : '#fb923c' }}>
                        {analyses[selected.id].score_oportunidad}<span style={{ fontSize: '1.5rem', opacity: 0.5 }}>/100</span>
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: 20 }}>
                      <div className="ai-score-label">Prob. de Ganar</div>
                      <div className="ai-score-big" style={{ color: '#a78bfa' }}>
                        {analyses[selected.id].probabilidad_exito}<span style={{ fontSize: '1.5rem', opacity: 0.5 }}>%</span>
                      </div>
                    </div>
                  </div>

                  <p style={{ fontSize: '1rem', lineHeight: 1.7, color: 'rgba(255,255,255,0.85)', marginBottom: '2rem', position: 'relative' }}>
                    {analyses[selected.id].resumen_ejecutivo}
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', position: 'relative' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#34d399', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '0.06em' }}>✓ Oportunidades</div>
                      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {analyses[selected.id].puntos_clave?.map((item, i) => (
                          <li key={i} style={{ fontSize: '0.83rem', color: 'rgba(255,255,255,0.75)', display: 'flex', gap: '0.5rem' }}>
                            <CheckCircle2 size={14} style={{ color: '#34d399', flexShrink: 0, marginTop: 2 }} />{item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#fb7185', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '0.06em' }}>⚠ Riesgos</div>
                      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {analyses[selected.id].riesgos_detectados?.map((item, i) => (
                          <li key={i} style={{ fontSize: '0.83rem', color: 'rgba(255,255,255,0.75)', display: 'flex', gap: '0.5rem' }}>
                            <AlertCircle size={14} style={{ color: '#fb7185', flexShrink: 0, marginTop: 2 }} />{item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="ai-cta">
                  <div className="ai-cta-icon"><Zap size={36} color="white" /></div>
                  <h2>Consultor Experto IA</h2>
                  <p>Obtén antecedentes históricos, score de oportunidad, análisis técnico-económico y tips para ganar.</p>
                  <button className="btn btn-gradient" style={{ fontSize: '1rem', padding: '1rem 2.5rem' }}
                    onClick={() => generateAnalysis(selected)} disabled={analyzing || (user.role === 'guest')}>
                    {analyzing
                      ? <><div className="loader-ring" style={{ width: 20, height: 20, borderWidth: 3 }} /> Procesando...</>
                      : user.role === 'guest'
                        ? <><Zap size={18} /> Solo para usuarios registrados</>
                        : <><Sparkles size={18} /> Generar Reporte PRO</>
                    }
                  </button>
                  {user.role !== 'guest' && (
                    <p style={{ marginTop: '1.25rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>Costo: 10 tokens · Tiempo estimado: 15 seg</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
