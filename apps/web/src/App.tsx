import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { Shield, Search, FileText, AlertTriangle, ExternalLink, Building, Filter, X, Zap, Target, Download, Coins, LogIn, Lock, CheckCircle2, Activity, Settings, UserCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Procurement {
  id: string;
  source_id: string;
  external_id: string;
  licitation_number: string;
  title: string;
  description: string;
  status: string;
  type: string;
  amount: number | null;
  currency: string | null;
  dependency_name: string | null;
  state: string | null;
  publication_date: string | null;
  opening_date: string | null;
  source_url: string;
  created_at: string;
}

interface Attachment {
  id: string;
  procurement_id: string;
  file_name: string;
  file_url: string;
}

interface ExpertAnalysis {
  antecedentes: string;
  resumen_ejecutivo: string;
  tips_ganadores: string[];
  alertas_riesgo: string[];
  fase_tecnica: string[];
  fase_economica: string[];
  score_oportunidad: number;
  probabilidad_ganar: number;
  veredicto: 'ALTA_OPORTUNIDAD' | 'OPORTUNIDAD_MODERADA' | 'RIESGO_ELEVADO' | 'POSIBLE_DIRIGIDA';
}

// TIPOS SAAS
type UserRole = 'admin' | 'guest' | 'user';

interface LocalUser {
  email: string;
  role: UserRole;
  tokens: number;
}

function App() {
  const [procurements, setProcurements] = useState<Procurement[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterState, setFilterState] = useState('');
  
  const [selectedProcurement, setSelectedProcurement] = useState<Procurement | null>(null);

  // SAAS STATES (Mocked Auth)
  const [user, setUser] = useState<LocalUser | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  
  const [analyzingItem, setAnalyzingItem] = useState<string | null>(null);
  const [generatedAnalyses, setGeneratedAnalyses] = useState<Record<string, ExpertAnalysis>>({});

  // VIEW STATES
  const [currentView, setCurrentView] = useState<'radar' | 'admin'>('radar');

  useEffect(() => {
    // Intentar recuperar sesión mockeada
    const savedUser = localStorage.getItem('radar_mock_user');
    if (savedUser) {
      const parsed = JSON.parse(savedUser);
      setUser(parsed);
      if (parsed) fetchData();
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    
    setTimeout(() => {
      let loggedInUser: LocalUser;
      
      if (email === 'admin@radar.com' && password === 'admin123') {
        loggedInUser = { email: 'admin@radar.com', role: 'admin', tokens: 999999 };
      } else {
        // Simulamos un usuario normal
        loggedInUser = { email, role: 'user', tokens: 100 };
      }
      
      localStorage.setItem('radar_mock_user', JSON.stringify(loggedInUser));
      setUser(loggedInUser);
      setAuthLoading(false);
      fetchData();
    }, 1000);
  };

  const handleGuestLogin = () => {
    const guestUser: LocalUser = { email: 'invitado@demo.com', role: 'guest', tokens: 0 };
    localStorage.setItem('radar_mock_user', JSON.stringify(guestUser));
    setUser(guestUser);
    fetchData();
  };

  const handleLogout = () => {
    localStorage.removeItem('radar_mock_user');
    setUser(null);
    setCurrentView('radar');
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: procData, error: procError } = await supabase
        .from('procurements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (procError) throw procError;
      const fetchedProcurements = procData || [];
      setProcurements(fetchedProcurements);

      if (fetchedProcurements.length > 0) {
        const procIds = fetchedProcurements.map(p => p.id);
        const { data: attData } = await supabase
          .from('attachments')
          .select('id, procurement_id, file_name, file_url')
          .in('procurement_id', procIds);
          
        setAttachments(attData || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateExpertAnalysis = async (procId: string) => {
    if (!user) return;

    if (user.tokens < 50 && user.role !== 'admin') {
      alert('No tienes suficientes tokens. Adquiere más para continuar.');
      return;
    }

    setAnalyzingItem(procId);

    const proc = procurements.find(p => p.id === procId);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const res = await fetch(
        `${supabaseUrl}/functions/v1/analyze-procurement`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
          },
          body: JSON.stringify({
            procurement_id: procId,
            title: proc?.title,
            dependency_name: proc?.dependency_name,
            state: proc?.state,
            amount: proc?.amount,
            licitation_number: proc?.licitation_number,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error desconocido en Edge Function');
      }

      const analysis: ExpertAnalysis = {
        antecedentes: data.analysis.antecedentes || 'No disponible.',
        resumen_ejecutivo: data.analysis.resumen_ejecutivo || '',
        tips_ganadores: Array.isArray(data.analysis.tips_ganadores) ? data.analysis.tips_ganadores : [],
        alertas_riesgo: Array.isArray(data.analysis.alertas_riesgo) ? data.analysis.alertas_riesgo : [],
        fase_tecnica: Array.isArray(data.analysis.fase_tecnica) ? data.analysis.fase_tecnica : [],
        fase_economica: Array.isArray(data.analysis.fase_economica) ? data.analysis.fase_economica : [],
        score_oportunidad: typeof data.analysis.score_oportunidad === 'number' ? data.analysis.score_oportunidad : 0,
        probabilidad_ganar: typeof data.analysis.probabilidad_ganar === 'number' ? data.analysis.probabilidad_ganar : 0,
        veredicto: data.analysis.veredicto || 'OPORTUNIDAD_MODERADA',
      };

      // Descontar tokens
      if (user.role !== 'admin') {
        const updatedUser = { ...user, tokens: user.tokens - 50 };
        setUser(updatedUser);
        localStorage.setItem('radar_mock_user', JSON.stringify(updatedUser));
      }

      setGeneratedAnalyses(prev => ({ ...prev, [procId]: analysis }));
    } catch (err: any) {
      console.error('Error en Consultor IA:', err);
      alert(`Error generando análisis: ${err.message}. Verifica que la Edge Function está desplegada y OPENAI_API_KEY está configurada en Supabase.`);
    } finally {
      setAnalyzingItem(null);
    }
  };

  const getAttachmentsForProcurement = (procId: string) => {
    return attachments.filter(a => a.procurement_id === procId);
  };

  const filteredProcurements = procurements.filter((p) => {
    const matchesSearch = 
      (p.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.licitation_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.dependency_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesState = filterState === '' || p.state === filterState;
    return matchesSearch && matchesState;
  });

  const uniqueStates = Array.from(new Set(procurements.map(p => p.state).filter(Boolean))) as string[];

  // La fecha principal es siempre cuándo fue encontrada (created_at)
  const getDisplayDate = (p: Procurement) => {
    return p.created_at || p.publication_date || p.opening_date;
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/D';
    try {
      return format(new Date(dateString), "dd MMM yyyy, h:mm a", { locale: es });
    } catch (e) {
      return dateString;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('vigente') || s.includes('publicad')) return 'badge-success';
    if (s.includes('desierta') || s.includes('cancelad')) return 'badge-danger';
    if (s.includes('evaluaci') || s.includes('fallo')) return 'badge-warning';
    return 'badge-neutral';
  };

  // -----------------------------
  // VISTA DE LOGIN
  // -----------------------------
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50" style={{ backgroundColor: 'var(--bg-surface-variant)' }}>
        <div className="card" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem' }}>
          <div className="flex justify-center mb-6">
            <div style={{ background: 'var(--google-blue)', padding: '12px', borderRadius: '16px', color: 'white' }}>
              <Shield size={32} />
            </div>
          </div>
          <h1 style={{ fontSize: '1.5rem', textAlign: 'center', marginBottom: '0.5rem' }}>Radar OSINT SaaS</h1>
          <p className="text-muted" style={{ textAlign: 'center', marginBottom: '2rem' }}>Inicia sesión para acceder a la inteligencia comercial.</p>
          
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Correo Electrónico</label>
              <input 
                type="email" 
                required
                className="search-input" 
                style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@radar.com"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Contraseña</label>
              <input 
                type="password" 
                required
                className="search-input" 
                style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="admin123"
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem', padding: '0.8rem' }} disabled={authLoading}>
              {authLoading ? <div style={{ width: '20px', height: '20px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div> : <><LogIn size={18} /> Iniciar Sesión</>}
            </button>
          </form>

          <div style={{ marginTop: '2rem', textAlign: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>¿No tienes cuenta? Explora la plataforma.</p>
            <button onClick={handleGuestLogin} className="btn btn-secondary" style={{ width: '100%' }}>
              <UserCircle size={18} /> Entrar como Invitado
            </button>
          </div>

          <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--google-blue-light)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--google-blue-hover)' }}>
            <strong>Acceso Super Admin:</strong><br/>
            Email: admin@radar.com<br/>
            Pass: admin123
          </div>
        </div>
      </div>
    );
  }

  // -----------------------------
  // VISTA DE ADMIN DASHBOARD
  // -----------------------------
  if (currentView === 'admin' && user.role === 'admin') {
    return (
      <div className="app">
        <header className="header">
          <div className="container flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div style={{ background: 'var(--google-red)', padding: '10px', borderRadius: '12px', color: 'white' }}>
                <Settings size={28} />
              </div>
              <div>
                <h1 style={{ fontSize: '1.4rem', marginBottom: 0, fontWeight: 700 }}>Panel Administrativo</h1>
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>Control SaaS y Usuarios</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button className="btn btn-secondary" onClick={() => setCurrentView('radar')}>
                Volver al Radar
              </button>
            </div>
          </div>
        </header>
        
        <main className="container" style={{ marginTop: '2rem', paddingBottom: '4rem' }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="card flex flex-col gap-2">
              <span className="text-muted" style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.8rem' }}>Usuarios Activos</span>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--google-blue)' }}>124</span>
              <span className="text-muted" style={{ fontSize: '0.85rem' }}>+12 este mes</span>
            </div>
            <div className="card flex flex-col gap-2">
              <span className="text-muted" style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.8rem' }}>Análisis IA Generados</span>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--google-green)' }}>892</span>
              <span className="text-muted" style={{ fontSize: '0.85rem' }}>~44,600 tokens gastados</span>
            </div>
            <div className="card flex flex-col gap-2">
              <span className="text-muted" style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.8rem' }}>Ingresos Estimados (MRR)</span>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--google-yellow)' }}>$4,200</span>
              <span className="text-muted" style={{ fontSize: '0.85rem' }}>USD recurrentes</span>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={20} color="var(--google-blue)" /> Actividad Reciente de Usuarios (Mock)
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {[
                { time: 'Hace 2 min', user: 'juan.perez@constructora.com', action: 'Generó un Análisis de IA (Gasto: 50 tokens)', type: 'ia' },
                { time: 'Hace 15 min', user: 'invitado@demo.com', action: 'Intentó generar un análisis pero no tenía tokens', type: 'error' },
                { time: 'Hace 1 hora', user: 'contacto@techsolutions.mx', action: 'Compró Paquete Básico (1,000 tokens)', type: 'payment' },
                { time: 'Hace 3 horas', user: 'maria.g@gobierno.com', action: 'Inició sesión en la plataforma', type: 'login' },
              ].map((log, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '1rem', background: 'var(--bg-surface-variant)', borderRadius: '8px' }}>
                  <div style={{ padding: '8px', background: 'white', borderRadius: '50%' }}>
                    {log.type === 'ia' && <Zap size={16} color="var(--google-blue)" />}
                    {log.type === 'error' && <AlertTriangle size={16} color="var(--google-red)" />}
                    {log.type === 'payment' && <Coins size={16} color="var(--google-green)" />}
                    {log.type === 'login' && <LogIn size={16} color="var(--text-muted)" />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <strong style={{ fontSize: '0.9rem' }}>{log.user}</strong>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{log.time}</span>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{log.action}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // -----------------------------
  // VISTA PRINCIPAL RADAR (DASHBOARD)
  // -----------------------------
  return (
    <div className="app">
      <header className="header">
        <div className="container flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div style={{ background: 'var(--google-blue)', padding: '10px', borderRadius: '12px', color: 'white' }}>
              <Shield size={28} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.4rem', marginBottom: 0, fontWeight: 700 }}>Radar OSINT <span style={{fontSize: '0.8rem', background: 'var(--google-yellow-light)', color: '#b07d00', padding: '2px 6px', borderRadius: '4px', verticalAlign: 'middle', marginLeft: '8px'}}>PRO</span></h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            
            {user.role === 'admin' && (
              <button className="btn" style={{ background: 'var(--google-red-light)', color: 'var(--google-red)', padding: '0.4rem 1rem', fontSize: '0.85rem' }} onClick={() => setCurrentView('admin')}>
                <Settings size={16} /> Panel Admin
              </button>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-surface-variant)', padding: '6px 12px', borderRadius: '20px', fontWeight: 600, fontSize: '0.9rem' }}>
              <Coins size={16} color="var(--google-yellow)" />
              {user.role === 'admin' ? '∞' : user.tokens} Tokens
            </div>
            
            <div style={{ borderLeft: '1px solid var(--border-color)', height: '24px', margin: '0 4px' }}></div>
            
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{user.email.split('@')[0]}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{user.role === 'guest' ? 'Invitado' : user.role === 'admin' ? 'Super Admin' : 'Usuario Pro'}</span>
            </div>

            <button className="btn btn-secondary" onClick={handleLogout} style={{ padding: '0.4rem', borderRadius: '50%' }} title="Cerrar Sesión">
              <LogIn size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="container" style={{ marginTop: '2rem', paddingBottom: '4rem' }}>
        
        {/* Search Bar */}
        <div className="flex flex-col md:flex-row gap-4 justify-between" style={{ marginBottom: '2.5rem' }}>
          <div className="search-bar-wrapper" style={{ flex: '1', maxWidth: '600px' }}>
            <Search size={22} color="var(--text-muted)" />
            <input 
              type="text" 
              className="search-input" 
              placeholder="Buscar por título, expediente o dependencia..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div style={{ position: 'relative' }}>
            <Filter size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <select 
              className="select-input" 
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
            >
              <option value="">Cualquier Estado</option>
              {uniqueStates.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '5rem 0', textAlign: 'center' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid var(--google-blue-light)', borderTopColor: 'var(--google-blue)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }}></div>
            <p className="text-muted" style={{ marginTop: '1.5rem', fontWeight: 500 }}>Descargando base de datos nacional...</p>
          </div>
        ) : filteredProcurements.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem 0' }}>
            <AlertTriangle size={48} color="var(--google-yellow)" style={{ margin: '0 auto 1rem' }} />
            <h2>Sin resultados</h2>
            <p className="text-muted" style={{ marginTop: '0.5rem', marginBottom: '1.5rem' }}>Intenta cambiar los filtros o los términos de búsqueda.</p>
            <button className="btn btn-secondary" onClick={() => {setSearchTerm(''); setFilterState('');}}>
              Limpiar filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProcurements.map((procurement, index) => {
              const hasAnalysis = !!generatedAnalyses[procurement.id];
              
              return (
                <div 
                  key={procurement.id} 
                  className="card card-hover animate-item flex flex-col justify-between"
                  style={{ animationDelay: `${index * 0.03}s`, cursor: 'pointer', border: hasAnalysis ? '1px solid var(--google-blue-light)' : '1px solid transparent' }}
                  onClick={() => setSelectedProcurement(procurement)}
                >
                  <div>
                    <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
                      <span className={`badge ${getStatusBadgeClass(procurement.status)}`}>
                        {procurement.status}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                        {formatDate(getDisplayDate(procurement))}
                      </span>
                    </div>
                    
                    <h3 className="card-title">{procurement.title.length > 80 ? procurement.title.substring(0, 80) + '...' : procurement.title}</h3>
                    
                    <div className="card-meta">
                      <Building size={14} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {procurement.dependency_name || 'Sin dependencia'}
                      </span>
                    </div>
                    <div className="card-meta">
                      <FileText size={14} />
                      <span>{procurement.licitation_number || 'S/N'}</span>
                    </div>
                  </div>
                  
                  <div>
                    {hasAnalysis && (
                      <div className="ai-pills-container" style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: 'none' }}>
                        <div className="ai-pill" style={{ background: 'var(--google-green-light)', color: '#0d652d', width: '100%', justifyContent: 'center' }}>
                          <CheckCircle2 size={12} /> Análisis IA Completado
                        </div>
                      </div>
                    )}
                    
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {procurement.amount ? (
                        <span style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '1.1rem' }}>
                          ${procurement.amount.toLocaleString()} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{procurement.currency || 'MXN'}</span>
                        </span>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '0.85rem' }}>Monto abierto</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Slide-in Details Panel */}
      {selectedProcurement && (
        <div className="modal-backdrop" onClick={() => setSelectedProcurement(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.25rem' }}>Detalle de Licitación</h2>
              <button className="btn-icon" onClick={() => setSelectedProcurement(null)}>
                <X size={24} />
              </button>
            </div>
            
            <div className="modal-content">
              <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
                <span className={`badge ${getStatusBadgeClass(selectedProcurement.status)}`}>
                  {selectedProcurement.status}
                </span>
                <a href={selectedProcurement.source_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ padding: '0.4rem 1rem' }}>
                  Ir a Fuente <ExternalLink size={16} />
                </a>
              </div>
              
              <h1 style={{ fontSize: '1.75rem', marginBottom: '1.5rem', lineHeight: '1.3' }}>{selectedProcurement.title}</h1>
              
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Número de Licitación</span>
                  <span className="detail-value">{selectedProcurement.licitation_number}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Dependencia</span>
                  <span className="detail-value">{selectedProcurement.dependency_name || 'N/D'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Estado Geográfico</span>
                  <span className="detail-value">{selectedProcurement.state || 'N/D'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Encontrada el</span>
                  <span className="detail-value">{formatDate(selectedProcurement.created_at)}</span>
                </div>
                {(selectedProcurement.publication_date || selectedProcurement.opening_date) && (
                  <div className="detail-item">
                    <span className="detail-label">Fecha en Fuente</span>
                    <span className="detail-value">{formatDate(selectedProcurement.publication_date || selectedProcurement.opening_date)}</span>
                  </div>
                )}
              </div>

              {/* SECTION: AI ANALYSIS SAAS */}
              <div className="ai-card" style={{ background: generatedAnalyses[selectedProcurement.id] ? 'var(--bg-surface)' : 'var(--bg-surface-variant)', border: generatedAnalyses[selectedProcurement.id] ? '2px solid var(--google-blue-light)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', color: 'var(--google-blue)' }}>
                  <Zap size={24} />
                  <h2 style={{ fontSize: '1.25rem', color: 'var(--google-blue)', margin: 0 }}>Consultor Experto IA</h2>
                </div>
                
                {generatedAnalyses[selectedProcurement.id] ? (
                  <div className="ai-results animate-item">

                    {/* VEREDICTO + SCORES */}
                    {(() => {
                      const a = generatedAnalyses[selectedProcurement.id];
                      const veredictoStyles: Record<string, {bg: string; color: string; label: string}> = {
                        ALTA_OPORTUNIDAD:    { bg: 'var(--google-green-light)',  color: '#0d652d', label: '🚀 Alta Oportunidad' },
                        OPORTUNIDAD_MODERADA:{ bg: 'var(--google-blue-light)',   color: 'var(--google-blue)', label: '📊 Oportunidad Moderada' },
                        RIESGO_ELEVADO:      { bg: '#fff3cd',                    color: '#856404', label: '⚠️ Riesgo Elevado' },
                        POSIBLE_DIRIGIDA:    { bg: 'var(--google-red-light)',    color: 'var(--google-red)', label: '🔒 Posible Licitación Dirigida' },
                      };
                      const v = veredictoStyles[a.veredicto] || veredictoStyles.OPORTUNIDAD_MODERADA;
                      return (
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                          <div style={{ flex: '1 1 200px', background: v.bg, color: v.color, padding: '0.75rem 1rem', borderRadius: '8px', fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center' }}>
                            {v.label}
                          </div>
                          <div style={{ flex: '0 0 auto', background: 'var(--bg-surface-variant)', padding: '0.75rem 1.25rem', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--google-blue)' }}>{a.score_oportunidad}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Score /100</div>
                          </div>
                          <div style={{ flex: '0 0 auto', background: 'var(--bg-surface-variant)', padding: '0.75rem 1.25rem', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--google-green)' }}>{a.probabilidad_ganar}%</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Prob. Ganar</div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* RESUMEN EJECUTIVO */}
                    {generatedAnalyses[selectedProcurement.id].resumen_ejecutivo && (
                      <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--bg-surface-variant)', borderRadius: '8px', borderLeft: '3px solid var(--google-blue)' }}>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', margin: 0, lineHeight: 1.6 }}>
                          {generatedAnalyses[selectedProcurement.id].resumen_ejecutivo}
                        </p>
                      </div>
                    )}

                    {/* ANTECEDENTES */}
                    <div style={{ marginBottom: '1.5rem' }}>
                      <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <FileText size={16} color="var(--google-blue)" /> Antecedentes
                      </h4>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', background: 'var(--bg-surface-variant)', padding: '1rem', borderRadius: '8px', margin: 0 }}>
                        {generatedAnalyses[selectedProcurement.id].antecedentes}
                      </p>
                    </div>

                    {/* TIPS PARA GANAR */}
                    {generatedAnalyses[selectedProcurement.id].tips_ganadores.length > 0 && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <h4 style={{ color: 'var(--google-green)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Target size={16} /> Tips para Ganar
                        </h4>
                        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: 0, margin: 0 }}>
                          {generatedAnalyses[selectedProcurement.id].tips_ganadores.map((tip, i) => (
                            <li key={i} style={{ position: 'relative', paddingLeft: '1.5rem', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                              <span style={{ position: 'absolute', left: 0, color: 'var(--google-green)', fontWeight: 'bold' }}>✓</span> {tip}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* ALERTAS DE RIESGO */}
                    {generatedAnalyses[selectedProcurement.id].alertas_riesgo.length > 0 && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <h4 style={{ color: 'var(--google-red)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <AlertTriangle size={16} /> Alertas y Candados
                        </h4>
                        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: 0, margin: 0 }}>
                          {generatedAnalyses[selectedProcurement.id].alertas_riesgo.map((alerta, i) => (
                            <li key={i} style={{ position: 'relative', paddingLeft: '1.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                              <span style={{ position: 'absolute', left: 0, color: 'var(--google-red)' }}>⚠</span> {alerta}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* FASE TÉCNICA + ECONÓMICA */}
                    <div className="detail-grid" style={{ marginBottom: 0 }}>
                      <div className="detail-item" style={{ background: 'var(--bg-color)', padding: '1rem', borderRadius: '8px' }}>
                        <span className="detail-label" style={{ color: 'var(--google-blue)' }}>Fase Técnica</span>
                        <ul style={{ listStyle: 'none', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: 0 }}>
                          {generatedAnalyses[selectedProcurement.id].fase_tecnica.map((t, i) => (
                            <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>• {t}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="detail-item" style={{ background: 'var(--bg-color)', padding: '1rem', borderRadius: '8px' }}>
                        <span className="detail-label" style={{ color: 'var(--google-yellow)' }}>Fase Económica</span>
                        <ul style={{ listStyle: 'none', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: 0 }}>
                          {generatedAnalyses[selectedProcurement.id].fase_economica.map((e, i) => (
                            <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>• {e}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                      Obtén un desglose estratégico completo, antecedentes históricos y consejos para armar la propuesta técnica y económica perfecta.
                    </p>
                    <button 
                      className="btn btn-primary" 
                      style={{ width: '100%', padding: '1rem', fontSize: '1rem' }}
                      onClick={() => generateExpertAnalysis(selectedProcurement.id)}
                      disabled={analyzingItem === selectedProcurement.id}
                    >
                      {analyzingItem === selectedProcurement.id ? (
                        <>
                          <div style={{ width: '20px', height: '20px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                          Procesando documentos con IA...
                        </>
                      ) : (
                        <>
                          <Lock size={18} /> Generar Análisis Experto (🪙 50 Tokens)
                        </>
                      )}
                    </button>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                      Se descargarán los anexos y se procesarán utilizando LLMs avanzados.
                    </p>
                  </div>
                )}
              </div>

              {getAttachmentsForProcurement(selectedProcurement.id).length > 0 && (
                <div style={{ marginTop: '2.5rem' }}>
                  <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem' }}>Documentos Base</h3>
                  <div>
                    {getAttachmentsForProcurement(selectedProcurement.id).map(att => (
                      <a key={att.id} href={att.file_url} target="_blank" rel="noopener noreferrer" className="doc-item">
                        <div className="doc-icon">
                          <FileText size={20} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{att.file_name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Anexo Oficial</div>
                        </div>
                        <Download size={20} color="var(--google-blue)" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
