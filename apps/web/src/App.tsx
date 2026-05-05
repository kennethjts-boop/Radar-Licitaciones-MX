import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { Search, Building, X, Zap, Coins, LogIn, CheckCircle2, MapPin, Calendar, ChevronRight, Sparkles, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Procurement {
  id: string;
  source_id: string;
  external_id: string;
  title: string;
  description: string | null;
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
  veredicto: 'ALTA_OPORTUNIDAD' | 'MODERADA' | 'POSIBLE_DIRIGIDA' | 'RIESGO_ALTO';
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
  const [selectedProcurement, setSelectedProcurement] = useState<Procurement | null>(null);
  
  // Auth & SaaS State
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // AI Analysis State
  const [analyzing, setAnalyzing] = useState(false);
  const [generatedAnalyses, setGeneratedAnalyses] = useState<Record<string, AnalysisResult>>({});

  useEffect(() => {
    fetchProcurements();
    // Check local session
    const savedUser = localStorage.getItem('radar_user');
    if (savedUser) setUser(JSON.parse(savedUser));
  }, []);

  const fetchProcurements = async () => {
    try {
      const { data, error } = await supabase
        .from('procurements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      setProcurements(data || []);
    } catch (err) {
      console.error('Error fetching procurements:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setTimeout(() => {
      let role: 'admin' | 'user' = 'user';
      if (email === 'admin@radar.com') role = 'admin';
      const userData: User = { email, role, tokens: role === 'admin' ? 999999 : 50 };
      setUser(userData);
      localStorage.setItem('radar_user', JSON.stringify(userData));
      setAuthLoading(false);
    }, 800);
  };

  const handleGuestLogin = () => {
    const guest: User = { email: 'invitado@demo.com', role: 'guest', tokens: 0 };
    setUser(guest);
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('radar_user');
  };

  const generateExpertAnalysis = async (procurement: Procurement) => {
    if (user?.tokens === 0 && user.role !== 'admin') {
      alert("No tienes tokens suficientes. Por favor, recarga tu cuenta.");
      return;
    }

    setAnalyzing(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      
      const res = await fetch(`${supabaseUrl}/functions/v1/analyze-procurement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ procurementId: procurement.id })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Error en el análisis');
      }

      const analysis: AnalysisResult = await res.json();
      setGeneratedAnalyses(prev => ({ ...prev, [procurement.id]: analysis }));
      
      // Deduct token (mock)
      if (user && user.role !== 'admin') {
        const updatedUser = { ...user, tokens: user.tokens - 10 };
        setUser(updatedUser);
        localStorage.setItem('radar_user', JSON.stringify(updatedUser));
      }
    } catch (err: any) {
      alert(`Error generando análisis: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const filteredProcurements = procurements.filter(p => {
    const matchesSearch = p.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         (p.licitation_number?.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesState = filterState ? p.state === filterState : true;
    return matchesSearch && matchesState;
  });

  const uniqueStates = Array.from(new Set(procurements.map(p => p.state).filter(Boolean))) as string[];

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Pendiente';
    try {
      return format(new Date(dateString), "dd MMM yyyy", { locale: es });
    } catch (e) {
      return dateString;
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen login-bg">
        <div className="login-premium-card animate-slide">
          <div className="flex justify-center mb-10">
            <div className="logo-box">
              <Sparkles size={28} />
            </div>
          </div>
          <h1 style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: '0.75rem' }}>Radar OSINT</h1>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '3rem' }}>Inteligencia estratégica para licitaciones públicas.</p>
          
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Email</label>
              <input type="email" required className="input-premium" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@empresa.com" />
            </div>
            <div className="flex flex-col gap-2">
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Contraseña</label>
              <input type="password" required className="input-premium" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <button type="submit" className="btn-premium btn-blue" style={{ width: '100%', marginTop: '1rem' }} disabled={authLoading}>
              {authLoading ? 'Verificando...' : 'Entrar al Radar'}
            </button>
          </form>

          <div style={{ marginTop: '2.5rem', textAlign: 'center' }}>
            <button onClick={handleGuestLogin} className="btn-premium btn-white" style={{ width: '100%' }}>
              Explorar como Invitado
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade">
      <header className="header">
        <div className="container flex justify-between items-center">
          <div className="logo-wrap">
            <div className="logo-box">
              <Sparkles size={24} />
            </div>
            <h1 className="logo-text">Radar OSINT</h1>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2" style={{ background: 'white', padding: '0.6rem 1.2rem', borderRadius: '14px', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)' }}>
              <Coins size={16} color="var(--brand-primary)" />
              <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{user.role === 'admin' ? 'ILIMITADO' : `${user.tokens} TOKENS`}</span>
            </div>
            
            <button className="btn-premium btn-white" style={{ padding: '0.6rem' }} onClick={handleLogout}>
              <LogIn size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="container" style={{ marginTop: '3rem', paddingBottom: '6rem' }}>
        <div className="flex flex-col md:flex-row gap-6 mb-12 items-center">
          <div className="search-bar-wrapper" style={{ flex: 1, maxWidth: '800px' }}>
            <Search size={20} color="var(--text-muted)" />
            <input 
              className="search-input" 
              placeholder="Buscar por licitación, dependencia o expediente..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <select className="input-premium" style={{ width: 'auto', minWidth: '200px', padding: '0.6rem 1.2rem' }} value={filterState} onChange={e => setFilterState(e.target.value)}>
            <option value="">Todos los Estados</option>
            {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '10rem 0' }}>
            <Sparkles className="animate-spin" size={48} color="var(--brand-primary)" style={{ margin: '0 auto 2rem' }} />
            <h2 style={{ color: 'var(--text-secondary)' }}>Sincronizando Base de Datos Nacional...</h2>
          </div>
        ) : (
          <div className="grid xl:grid-cols-4 lg:grid-cols-3 md:grid-cols-2 gap-8">
            {filteredProcurements.map((p, i) => (
              <div key={p.id} className="card-premium animate-slide" style={{ animationDelay: `${i * 0.05}s`, cursor: 'pointer' }} onClick={() => setSelectedProcurement(p)}>
                <div className="flex justify-between items-start mb-6">
                  <span className={`badge-premium ${p.status.includes('ACTIVA') ? 'badge-green' : 'badge-blue'}`}>{p.status}</span>
                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                    <Calendar size={12} /> {formatDate(p.created_at)}
                  </div>
                </div>
                
                <h3 className="card-title">{p.title}</h3>
                
                <div className="flex flex-col gap-3 mb-8">
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                    <Building size={14} className="text-slate-300" />
                    {p.dependency_name || 'N/D'}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                    <MapPin size={14} className="text-slate-300" />
                    {p.state || 'Nacional'}
                  </div>
                </div>
                
                <div className="mt-auto pt-6 border-t border-slate-50 flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Monto Est.</span>
                    <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{p.amount ? `$${p.amount.toLocaleString()}` : 'ABIERT'}</span>
                  </div>
                  {generatedAnalyses[p.id] ? (
                    <div className="flex items-center gap-1 text-emerald-500">
                      <Zap size={16} fill="currentColor" />
                      <span className="text-[11px] font-black">PRO</span>
                    </div>
                  ) : (
                    <ChevronRight size={20} className="text-slate-200" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {selectedProcurement && (
        <div className="panel-backdrop" onClick={() => setSelectedProcurement(null)}>
          <div className="panel-content" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <div className="flex items-center gap-4">
                <div className="badge-premium badge-blue">Expediente {selectedProcurement.licitation_number}</div>
              </div>
              <button className="btn-premium btn-white" style={{ padding: '0.6rem', borderRadius: '50%' }} onClick={() => setSelectedProcurement(null)}>
                <X size={20} />
              </button>
            </div>
            
            <div className="panel-body">
              <h1 style={{ fontSize: '2rem', marginBottom: '1.5rem', lineHeight: 1.2 }}>{selectedProcurement.title}</h1>
              
              <div className="grid md:grid-cols-2 gap-4 mb-10">
                <div className="detail-section">
                  <div className="detail-label">Dependencia</div>
                  <div className="detail-value">{selectedProcurement.dependency_name}</div>
                </div>
                <div className="detail-section">
                  <div className="detail-label">Lugar</div>
                  <div className="detail-value">{selectedProcurement.state || 'México'}</div>
                </div>
                <div className="detail-section">
                  <div className="detail-label">Detección Radar</div>
                  <div className="detail-value">{formatDate(selectedProcurement.created_at)}</div>
                </div>
                <div className="detail-section">
                  <div className="detail-label">Monto Referencia</div>
                  <div className="detail-value">{selectedProcurement.amount ? `$${selectedProcurement.amount.toLocaleString()} MXN` : 'Abierto'}</div>
                </div>
              </div>

              {generatedAnalyses[selectedProcurement.id] ? (
                <div className="ai-premium-card">
                  <div className="flex justify-between items-start mb-8">
                    <div>
                      <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Análisis Estratégico IA</h2>
                      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>Resultados basados en RAG y modelos expertos de contratación pública.</p>
                    </div>
                    <div className="logo-box" style={{ background: 'rgba(255,255,255,0.1)', boxShadow: 'none' }}>
                      <Zap size={24} color="var(--brand-primary)" />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6 mb-10">
                    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '20px' }}>
                      <div className="detail-label" style={{ color: 'rgba(255,255,255,0.4)' }}>Score de Oportunidad</div>
                      <div style={{ fontSize: '2.5rem', fontWeight: 900 }}>{generatedAnalyses[selectedProcurement.id].score_oportunidad}/100</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '20px' }}>
                      <div className="detail-label" style={{ color: 'rgba(255,255,255,0.4)' }}>Probabilidad Ganar</div>
                      <div style={{ fontSize: '2.5rem', fontWeight: 900 }}>{generatedAnalyses[selectedProcurement.id].probabilidad_exito}%</div>
                    </div>
                  </div>

                  <div className="mb-8">
                    <h3 style={{ color: '#60a5fa', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <CheckCircle2 size={20} /> Veredicto del Consultor
                    </h3>
                    <p style={{ fontSize: '1.1rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.9)' }}>
                      {generatedAnalyses[selectedProcurement.id].resumen_ejecutivo}
                    </p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-8">
                    <div>
                      <h4 style={{ fontSize: '0.9rem', color: '#10b981', marginBottom: '1rem' }}>PUNTOS CLAVE</h4>
                      <ul style={{ listStyle: 'none' }}>
                        {generatedAnalyses[selectedProcurement.id].puntos_clave.map((item, i) => (
                          <li key={i} style={{ fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                            <ChevronRight size={14} className="text-emerald-500" /> {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 style={{ fontSize: '0.9rem', color: '#f43f5e', marginBottom: '1rem' }}>RIESGOS</h4>
                      <ul style={{ listStyle: 'none' }}>
                        {generatedAnalyses[selectedProcurement.id].riesgos_detectados.map((item, i) => (
                          <li key={i} style={{ fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                            <AlertCircle size={14} className="text-rose-500" /> {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ background: '#0f172a', padding: '3rem', borderRadius: '32px', textAlign: 'center', color: 'white' }}>
                  <Zap size={48} className="mb-6" style={{ margin: '0 auto 1.5rem', color: 'var(--brand-primary)' }} />
                  <h2 style={{ marginBottom: '1rem' }}>Desbloquear Análisis Experto</h2>
                  <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '2rem' }}>Obtén el análisis de riesgos, score de oportunidad y tips técnicos para ganar esta licitación.</p>
                  <button 
                    className="btn-premium btn-blue" 
                    onClick={() => generateExpertAnalysis(selectedProcurement)}
                    disabled={analyzing}
                  >
                    {analyzing ? (
                      <>Procesando Inteligencia...</>
                    ) : (
                      <><Sparkles size={20} /> Generar Reporte PRO</>
                    )}
                  </button>
                  <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>Costo: 10 Tokens • Tiempo est.: 15 segundos</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
