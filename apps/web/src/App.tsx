import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { Shield, Search, FileText, AlertTriangle, ExternalLink, Calendar, Building, Trophy, Filter, X, Zap, Target, Flag, Download } from 'lucide-react';
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

interface Analysis {
  attachment_id: string;
  score_total: number;
  score_tech: number;
  score_commercial: number;
  win_probability: number;
  category_detected: string;
  is_relevant: boolean;
  summary: string;
  contract_type: string;
  deadline: string;
  opportunities: string[];
  risks: string[];
  red_flags: string[];
}

function App() {
  const [procurements, setProcurements] = useState<Procurement[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterState, setFilterState] = useState('');
  const [vipMode, setVipMode] = useState(false);
  
  const [selectedProcurement, setSelectedProcurement] = useState<Procurement | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Procurements
      const { data: procData, error: procError } = await supabase
        .from('procurements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (procError) throw procError;
      const fetchedProcurements = procData || [];
      setProcurements(fetchedProcurements);

      // 2. Fetch Attachments for these procurements
      if (fetchedProcurements.length > 0) {
        const procIds = fetchedProcurements.map(p => p.id);
        const { data: attData } = await supabase
          .from('attachments')
          .select('id, procurement_id, file_name, file_url')
          .in('procurement_id', procIds);
          
        const fetchedAttachments = attData || [];
        setAttachments(fetchedAttachments);

        // 3. Fetch Analysis for these attachments
        if (fetchedAttachments.length > 0) {
          const attIds = fetchedAttachments.map(a => a.id);
          const { data: anaData } = await supabase
            .from('document_analysis')
            .select('*')
            .in('attachment_id', attIds);
            
          setAnalyses(anaData || []);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper getters
  const getAnalysisForProcurement = (procId: string) => {
    const procAtts = attachments.filter(a => a.procurement_id === procId);
    const attIds = procAtts.map(a => a.id);
    const bestAnalysis = analyses
      .filter(ana => attIds.includes(ana.attachment_id))
      .sort((a, b) => b.score_total - a.score_total)[0];
    return bestAnalysis || null;
  };

  const getAttachmentsForProcurement = (procId: string) => {
    return attachments.filter(a => a.procurement_id === procId);
  };

  const isVip = (analysis: Analysis | null) => {
    if (!analysis) return false;
    return analysis.score_total >= 70 && analysis.win_probability >= 50 && analysis.is_relevant;
  };

  const filteredProcurements = procurements.filter((p) => {
    const matchesSearch = 
      (p.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.licitation_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.dependency_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesState = filterState === '' || p.state === filterState;
    
    const ana = getAnalysisForProcurement(p.id);
    const matchesVip = !vipMode || isVip(ana);

    return matchesSearch && matchesState && matchesVip;
  });

  const uniqueStates = Array.from(new Set(procurements.map(p => p.state).filter(Boolean))) as string[];

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/D';
    try {
      return format(new Date(dateString), "dd MMM yyyy", { locale: es });
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

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'var(--accent-success)';
    if (score >= 60) return 'var(--accent-warning)';
    return 'var(--accent-danger)';
  };

  return (
    <div className="app">
      <header className="header">
        <div className="container flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="glass p-3" style={{ borderRadius: '12px' }}>
              <Shield className="text-blue-500" size={28} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.5rem', marginBottom: 0 }}>Radar OSINT</h1>
              <p className="text-muted" style={{ fontSize: '0.85rem' }}>Inteligencia Comercial y Licitaciones</p>
            </div>
          </div>
          <div className="flex gap-4">
            <button className="btn btn-secondary" onClick={fetchData}>
              Actualizar
            </button>
            <button 
              className={`btn ${vipMode ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setVipMode(!vipMode)}
              style={{ position: 'relative', overflow: 'hidden' }}
            >
              <Trophy size={18} className={vipMode ? "text-yellow-300" : ""} /> 
              {vipMode ? "Filtro VIP Activo" : "Ver Oportunidades VIP"}
              {vipMode && <div className="glow-effect"></div>}
            </button>
          </div>
        </div>
      </header>

      <main className="container" style={{ marginTop: '2rem', paddingBottom: '4rem' }}>
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="input-group" style={{ flex: '1' }}>
              <div style={{ position: 'relative' }}>
                <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="text" 
                  className="input" 
                  placeholder="Buscar por título, número o dependencia..." 
                  style={{ paddingLeft: '2.5rem' }}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            
            <div className="flex gap-4">
              <div className="input-group" style={{ minWidth: '200px' }}>
                <div style={{ position: 'relative' }}>
                  <Filter size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <select 
                    className="input" 
                    style={{ paddingLeft: '2.5rem', appearance: 'none' }}
                    value={filterState}
                    onChange={(e) => setFilterState(e.target.value)}
                  >
                    <option value="">Todos los Estados</option>
                    {uniqueStates.map(state => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '4rem 0', textAlign: 'center' }}>
            <div className="loader"></div>
            <p className="text-muted" style={{ marginTop: '1rem' }}>Cargando inteligencia...</p>
          </div>
        ) : filteredProcurements.length === 0 ? (
          <div className="glass-card empty-state">
            <AlertTriangle className="empty-icon" />
            <h2>No se encontraron resultados</h2>
            <p>Intenta cambiar los filtros o el término de búsqueda.</p>
            <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => {setSearchTerm(''); setFilterState(''); setVipMode(false);}}>
              Limpiar Filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProcurements.map((procurement, index) => {
              const analysis = getAnalysisForProcurement(procurement.id);
              const procVip = isVip(analysis);
              
              return (
                <div 
                  key={procurement.id} 
                  className={`glass-card flex flex-col justify-between animate-fade-in cursor-pointer hover-lift ${procVip ? 'vip-card' : ''}`}
                  style={{ animationDelay: `${index * 0.05}s` }}
                  onClick={() => setSelectedProcurement(procurement)}
                >
                  {procVip && (
                    <div className="vip-badge">
                      <Trophy size={12} /> Oportunidad VIP
                    </div>
                  )}
                  <div>
                    <div className="flex justify-between items-start" style={{ marginBottom: '1rem' }}>
                      <span className={`badge ${getStatusBadgeClass(procurement.status)}`}>
                        {procurement.status}
                      </span>
                      <span className="text-muted" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={12} /> {formatDate(procurement.publication_date)}
                      </span>
                    </div>
                    
                    <h3 style={{ marginBottom: '0.5rem', lineHeight: '1.4' }} className="line-clamp-2" title={procurement.title}>
                      {procurement.title}
                    </h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1rem' }}>
                      <div className="text-muted" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <FileText size={14} /> {procurement.licitation_number}
                      </div>
                      {procurement.dependency_name && (
                        <div className="text-muted" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Building size={14} /> {procurement.dependency_name}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {analysis && (
                    <div className="ai-stats-mini">
                      <div className="ai-stat-item">
                        <span className="ai-stat-label">Score</span>
                        <div className="ai-progress-bar">
                          <div className="ai-progress-fill" style={{ width: `${analysis.score_total}%`, backgroundColor: getScoreColor(analysis.score_total) }}></div>
                        </div>
                        <span className="ai-stat-value">{analysis.score_total}</span>
                      </div>
                      <div className="ai-stat-item">
                        <span className="ai-stat-label">Win Prob.</span>
                        <div className="ai-progress-bar">
                          <div className="ai-progress-fill" style={{ width: `${analysis.win_probability}%`, backgroundColor: getScoreColor(analysis.win_probability) }}></div>
                        </div>
                        <span className="ai-stat-value">{analysis.win_probability}%</span>
                      </div>
                    </div>
                  )}
                  
                  <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      {procurement.amount ? (
                        <span style={{ fontWeight: '600', color: 'var(--accent-success)' }}>
                          ${procurement.amount.toLocaleString()} {procurement.currency || 'MXN'}
                        </span>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '0.85rem' }}>Monto no especificado</span>
                      )}
                    </div>
                    <span className="text-blue-400" style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                      Ver Detalles &rarr;
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Modal Lateral de Detalles */}
      {selectedProcurement && (
        <div className="modal-backdrop animate-fade-in" onClick={() => setSelectedProcurement(null)}>
          <div className="modal-panel slide-in-right" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Detalles de Licitación</h2>
              <button className="btn-icon" onClick={() => setSelectedProcurement(null)}>
                <X size={24} />
              </button>
            </div>
            
            <div className="modal-content">
              <div className="flex justify-between items-start" style={{ marginBottom: '1rem' }}>
                <span className={`badge ${getStatusBadgeClass(selectedProcurement.status)}`}>
                  {selectedProcurement.status}
                </span>
                <a href={selectedProcurement.source_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
                  Abrir Fuente <ExternalLink size={14} />
                </a>
              </div>
              
              <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>{selectedProcurement.title}</h1>
              
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">Número</span>
                  <span className="info-value">{selectedProcurement.licitation_number}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Dependencia</span>
                  <span className="info-value">{selectedProcurement.dependency_name || 'N/D'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Estado</span>
                  <span className="info-value">{selectedProcurement.state || 'N/D'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Publicación</span>
                  <span className="info-value">{formatDate(selectedProcurement.publication_date)}</span>
                </div>
              </div>

              {getAnalysisForProcurement(selectedProcurement.id) ? (() => {
                const ana = getAnalysisForProcurement(selectedProcurement.id)!;
                return (
                  <div className="ai-analysis-section">
                    <div className="flex items-center gap-2" style={{ marginBottom: '1rem', color: 'var(--accent-primary)' }}>
                      <Zap size={20} />
                      <h2 style={{ marginBottom: 0 }}>Análisis de Inteligencia Artificial</h2>
                    </div>
                    
                    <div className="ai-scores-grid">
                      <div className="ai-score-box">
                        <span className="score-number" style={{ color: getScoreColor(ana.score_total) }}>{ana.score_total}</span>
                        <span className="score-label">Score Global</span>
                      </div>
                      <div className="ai-score-box">
                        <span className="score-number" style={{ color: getScoreColor(ana.win_probability) }}>{ana.win_probability}%</span>
                        <span className="score-label">Prob. de Ganar</span>
                      </div>
                      <div className="ai-score-box">
                        <span className="score-number" style={{ color: getScoreColor(ana.score_tech) }}>{ana.score_tech}</span>
                        <span className="score-label">Score Técnico</span>
                      </div>
                    </div>

                    <div className="ai-text-box">
                      <h3>Resumen Ejecutivo</h3>
                      <p>{ana.summary}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div className="ai-list-box success">
                        <h3><Target size={16} /> Oportunidades</h3>
                        <ul>
                          {ana.opportunities?.map((opp, i) => <li key={i}>{opp}</li>)}
                        </ul>
                      </div>
                      <div className="ai-list-box danger">
                        <h3><Flag size={16} /> Red Flags / Riesgos</h3>
                        <ul>
                          {ana.red_flags?.map((rf, i) => <li key={i}>{rf}</li>)}
                          {ana.risks?.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div className="glass-card" style={{ marginTop: '2rem', textAlign: 'center', opacity: 0.7 }}>
                  <p>Aún no hay análisis de IA disponible para esta licitación.</p>
                </div>
              )}

              {getAttachmentsForProcurement(selectedProcurement.id).length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                  <h3 style={{ marginBottom: '1rem' }}>Documentos Adjuntos</h3>
                  <div className="attachments-list">
                    {getAttachmentsForProcurement(selectedProcurement.id).map(att => (
                      <a key={att.id} href={att.file_url} target="_blank" rel="noopener noreferrer" className="attachment-item">
                        <FileText size={16} />
                        <span className="truncate">{att.file_name}</span>
                        <Download size={14} className="ml-auto opacity-50" />
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
