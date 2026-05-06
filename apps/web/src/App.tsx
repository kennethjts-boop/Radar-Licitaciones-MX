import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { Search, Building, X, Zap, Coins, LogIn, CheckCircle2, MapPin, ChevronRight, Sparkles, AlertCircle, Bell, Download, LayoutGrid, Rows3 } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import './App.css';

interface Procurement { id:string; title:string; status:string; dependency_name:string|null; licitation_number:string|null; opening_date:string|null; publication_date:string|null; amount:number|null; currency:string|null; url:string|null; state:string|null; created_at:string; }
interface User { email:string; role:'admin'|'user'|'guest'; tokens:number; }
interface AnalysisResult { resumen_ejecutivo:string; veredicto:string; score_oportunidad:number; probabilidad_exito:number; puntos_clave:string[]; riesgos_detectados:string[]; tips_ganadores:string[]; analisis_tecnico:string; analisis_economico:string; }

const streamItems = ['Nueva convocatoria CAPUFE', 'IMSS Tabasco: cierre en 24h', 'SCT publicó anexo técnico', 'Morelos: actualización de fallo'];

const StatusBadge = ({status}:{status:string}) => <span className={`badge ${badgeClass(status)}`}>{status}</span>;
const badgeClass = (status: string) => { const s=status.toLowerCase(); if (s.includes('activ')||s.includes('vigent')||s.includes('publicad')) return 'badge-active'; if (s.includes('desiert')||s.includes('cancel')) return 'badge-danger'; if (s.includes('evalua')||s.includes('fallo')) return 'badge-warning'; return 'badge-neutral'; };

export default function App() {
  const [procurements, setProcurements] = useState<Procurement[]>([]); const [loading, setLoading] = useState(true); const [searchTerm, setSearchTerm] = useState(''); const [filterState, setFilterState] = useState(''); const [selected, setSelected] = useState<Procurement | null>(null);
  const [user, setUser] = useState<User | null>(null); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [authLoading, setAuthLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false); const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({});

  useEffect(() => { fetchProcurements(); const saved = localStorage.getItem('radar_user'); if (saved) setUser(JSON.parse(saved)); }, []);
  const fetchProcurements = async () => { try { const { data, error } = await supabase.from('procurements').select('*').order('created_at', { ascending: false }).limit(120); if (error) throw error; setProcurements(data || []);} catch (e) { console.error(e);} finally { setLoading(false);} };
  const handleLogin = (e: React.FormEvent) => { e.preventDefault(); setAuthLoading(true); setTimeout(() => { const role = email === 'admin@radar.com' ? 'admin' : 'user'; const u: User = { email, role, tokens: role === 'admin' ? 999999 : 50 }; setUser(u); localStorage.setItem('radar_user', JSON.stringify(u)); setAuthLoading(false); }, 900); };
  const handleGuestLogin = () => setUser({ email: 'invitado@demo.com', role: 'guest', tokens: 0 });
  const handleLogout = () => { setUser(null); localStorage.removeItem('radar_user'); };

  const generateAnalysis = async (p: Procurement) => {
    if (user?.tokens === 0 && user.role !== 'admin') return alert('Sin tokens. Recarga tu cuenta.');
    setAnalyzing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-procurement`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` }, body: JSON.stringify({ procurementId: p.id }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error'); }
      const analysis: AnalysisResult = await res.json(); setAnalyses(prev => ({ ...prev, [p.id]: analysis }));
      if (user && user.role !== 'admin') { const u = { ...user, tokens: user.tokens - 10 }; setUser(u); localStorage.setItem('radar_user', JSON.stringify(u)); }
    } catch (e: any) { alert(`Error: ${e.message}`); } finally { setAnalyzing(false); }
  };

  const filtered = procurements.filter(p => (p.title.toLowerCase().includes(searchTerm.toLowerCase()) || p.licitation_number?.toLowerCase().includes(searchTerm.toLowerCase())) && (filterState ? p.state === filterState : true));
  const uniqueStates = Array.from(new Set(procurements.map(p => p.state).filter(Boolean))) as string[];
  const fmtDate = (d: string | null) => !d ? 'N/D' : format(new Date(d), 'dd MMM yyyy', { locale: es });

  if (!user) return <div className="login-page"><div className="blob blob-1"/><div className="blob blob-2"/><div className="blob blob-3"/><div className="login-card"><div className="login-brand"><div className="logo-icon"><Sparkles size={24}/></div><div><h1>Radar Licitaciones MX</h1><p>Inteligencia de licitaciones en tiempo real</p></div></div><form onSubmit={handleLogin} className="flex flex-col gap-4"><label className="input-label">Correo<input type="email" required className="input-field" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@radar.com"/></label><label className="input-label">Contraseña<input type="password" required className="input-field" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"/></label><button type="submit" className="btn btn-gradient" disabled={authLoading}>{authLoading ? 'Entrando...' : <> <Sparkles size={16}/> Entrar al Radar </>}</button></form><div className="divider"/><button onClick={handleGuestLogin} className="btn btn-ghost" style={{width:'100%'}}>Explorar como Invitado</button></div></div>;

  return <><div className="animated-bg"/>
    <header className="header"><div className="container topbar"><div className="logo-wrap"><div className="logo-icon"><Sparkles size={20}/></div><div><span className="logo-name">Radar Licitaciones</span><div className="logo-sub">MX · Intel Pública</div></div></div><div className="flex items-center gap-4"><div className="token-chip"><Coins size={14}/><span>{user.role === 'admin' ? '∞ ILIMITADO' : `${user.tokens} TOKENS`}</span></div><button className="btn btn-ghost btn-icon" onClick={handleLogout}><LogIn size={18}/></button></div></div></header>

    <main className="container app-shell">
      <section className="metrics-strip"><article className="metric-hero"><div className="metric-label">◉ Inteligencia · México · Live</div><div className="metric-main">{procurements.length}</div><div className="metric-foot">{filtered.length} resultados filtrados</div></article><article className="metric-card"><div className="metric-label">Activas</div><div className="metric-value">{filtered.filter(p=>badgeClass(p.status)==='badge-active').length}</div></article><article className="metric-card"><div className="metric-label">Dependencias</div><div className="metric-value">{new Set(filtered.map(p=>p.dependency_name)).size}</div></article><article className="metric-card"><div className="metric-label">Estados</div><div className="metric-value">{uniqueStates.length}</div></article></section>

      <section className="search-row"><div className="search-wrap"><Search size={18}/><input className="search-input" placeholder="Buscar licitación, dependencia, expediente..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/></div><select className="select-styled" value={filterState} onChange={e => setFilterState(e.target.value)}><option value="">Todos los Estados</option>{uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}</select><div className="view-switch"><button className="btn btn-ghost btn-icon"><LayoutGrid size={16}/></button><button className="btn btn-ghost btn-icon"><Rows3 size={16}/></button></div></section>

      <section className="stream-row"><span className="stream-pill">STREAM</span>{streamItems.map((s,i)=><span key={i} className="stream-item">{s}</span>)}</section>

      <section className="results-head"><div><h2>Radar activo</h2><p>{filtered.length} licitaciones · ordenado por recencia</p></div><div className="flex gap-2"><button className="btn btn-ghost"><Download size={14}/> Exportar CSV</button><button className="btn btn-gradient"><Bell size={14}/> Crear alerta</button></div></section>

      {loading ? <div className="loading-box"><div className="loader-ring" style={{width:52,height:52}}/></div> : <div className="grid xl:grid-cols-4 lg:grid-cols-3 sm:grid-cols-2 grid-cols-1" style={{gap:'1rem'}}>{filtered.map(p => <article key={p.id} className={`card ${analyses[p.id] ? 'card-glow' : ''}`} onClick={() => setSelected(p)}><div className="flex justify-between items-center mb-4"><StatusBadge status={p.status}/><span className="date-chip">{fmtDate(p.created_at)}</span></div><h3 className="card-title">{p.title}</h3><div className="flex flex-col gap-2 mb-6"><div className="card-meta"><Building size={13}/>{p.dependency_name || 'Sin dependencia'}</div><div className="card-meta"><MapPin size={13}/>{p.state || 'Nacional'}</div></div><div className="card-bottom"><div><div className="detail-label">Monto</div><div className="detail-value">{p.amount ? `$${p.amount.toLocaleString()}` : 'Abierto'}</div></div>{analyses[p.id] ? <div className="ai-chip"><Zap size={14}/>IA</div> : <ChevronRight size={18}/>}</div></article>)}</div>}
    </main>

    {selected && <div className="panel-backdrop" onClick={() => setSelected(null)}><div className="panel" onClick={e => e.stopPropagation()}><div className="panel-header"><StatusBadge status={selected.status}/><button className="btn btn-ghost btn-icon" onClick={() => setSelected(null)}><X size={18}/></button></div><div className="panel-body"><h1 className="panel-title">{selected.title}</h1><div className="detail-grid"><div className="detail-box"><div className="detail-label">Dependencia</div><div className="detail-value">{selected.dependency_name || 'N/D'}</div></div><div className="detail-box"><div className="detail-label">Estado</div><div className="detail-value">{selected.state || 'México'}</div></div><div className="detail-box"><div className="detail-label">Radar detectó</div><div className="detail-value">{fmtDate(selected.created_at)}</div></div><div className="detail-box"><div className="detail-label">Monto</div><div className="detail-value">{selected.amount ? `$${selected.amount.toLocaleString()} ${selected.currency || 'MXN'}` : 'Abierto'}</div></div></div>{selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{width:'100%', marginBottom:'1rem'}}>Ver Convocatoria Oficial ↗</a>}{analyses[selected.id] ? <div className="ai-result"><h3>{analyses[selected.id].veredicto?.replace(/_/g, ' ')}</h3><p>{analyses[selected.id].resumen_ejecutivo}</p></div> : <div className="ai-cta"><div className="ai-cta-icon"><Zap size={28}/></div><h2>Consultor Experto IA</h2><p>Score, riesgos y recomendaciones con datos del proceso.</p><button className="btn btn-gradient" onClick={() => generateAnalysis(selected)} disabled={analyzing || user.role === 'guest'}>{analyzing ? 'Procesando...' : user.role === 'guest' ? 'Solo usuarios registrados' : 'Generar Reporte PRO'}</button>{user.role !== 'guest' && <p style={{marginTop:'1rem',opacity:.6}}>Costo: 10 tokens</p>}</div>}</div></div></div>}
  </>;
}
