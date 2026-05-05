import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { Shield, Search, FileText, AlertTriangle, ExternalLink, Building, Trophy, Filter, X, Zap, Target, Download } from 'lucide-react';
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
          
        const fetchedAttachments = attData || [];
        setAttachments(fetchedAttachments);

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

  const getDisplayDate = (p: Procurement) => {
    return p.publication_date || p.opening_date || p.created_at;
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

  return (
    <div className="app">
      <header className="header">
        <div className="container flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div style={{ background: 'var(--google-blue)', padding: '10px', borderRadius: '12px', color: 'white' }}>
              <Shield size={28} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.4rem', marginBottom: 0, fontWeight: 700 }}>Radar OSINT</h1>
              <p className="text-muted" style={{ fontSize: '0.85rem' }}>Inteligencia Comercial y Licitaciones</p>
            </div>
          </div>
          <div className="flex gap-4">
            <button className="btn btn-secondary" onClick={fetchData}>
              Actualizar Datos
            </button>
            <button 
              className={`btn btn-vip ${vipMode ? 'active' : ''}`}
              onClick={() => setVipMode(!vipMode)}
            >
              <Trophy size={18} /> 
              {vipMode ? "Viendo solo VIP" : "Filtrar VIP"}
            </button>
          </div>
        </div>
      </header>

      <main className="container" style={{ marginTop: '2rem', paddingBottom: '4rem' }}>
        
        {/* Search Bar - Google Style */}
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
            <p className="text-muted" style={{ marginTop: '1.5rem', fontWeight: 500 }}>Descargando licitaciones...</p>
          </div>
        ) : filteredProcurements.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem 0' }}>
            <AlertTriangle size={48} color="var(--google-yellow)" style={{ margin: '0 auto 1rem' }} />
            <h2>Sin resultados</h2>
            <p className="text-muted" style={{ marginTop: '0.5rem', marginBottom: '1.5rem' }}>Intenta cambiar los filtros o los términos de búsqueda.</p>
            <button className="btn btn-secondary" onClick={() => {setSearchTerm(''); setFilterState(''); setVipMode(false);}}>
              Limpiar filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProcurements.map((procurement, index) => {
              const analysis = getAnalysisForProcurement(procurement.id);
              const procVip = isVip(analysis);
              
              return (
                <div 
                  key={procurement.id} 
                  className="card card-hover animate-item flex flex-col justify-between"
                  style={{ animationDelay: `${index * 0.03}s`, cursor: 'pointer' }}
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
                    {analysis && (
                      <div className="ai-pills-container">
                        <div className="ai-pill ai-pill-score">
                          <Zap size={12} /> Score: {analysis.score_total}
                        </div>
                        <div className="ai-pill ai-pill-prob">
                          <Target size={12} /> Win: {analysis.win_probability}%
                        </div>
                        {procVip && (
                          <div className="ai-pill ai-pill-vip">
                            <Trophy size={12} /> VIP
                          </div>
                        )}
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
                  <span className="detail-label">Fecha de Publicación</span>
                  <span className="detail-value">{formatDate(getDisplayDate(selectedProcurement))}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Monto Referencia</span>
                  <span className="detail-value" style={{ color: 'var(--google-green)', fontWeight: 700 }}>
                    {selectedProcurement.amount ? `$${selectedProcurement.amount.toLocaleString()} ${selectedProcurement.currency || 'MXN'}` : 'No especificado'}
                  </span>
                </div>
              </div>

              {getAnalysisForProcurement(selectedProcurement.id) ? (() => {
                const ana = getAnalysisForProcurement(selectedProcurement.id)!;
                return (
                  <div className="ai-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', color: 'var(--google-blue)' }}>
                      <Zap size={24} />
                      <h2 style={{ fontSize: '1.25rem', color: 'var(--google-blue)', margin: 0 }}>Análisis Inteligente</h2>
                    </div>
                    
                    <div className="ai-stat-row">
                      <div className="ai-stat-big" style={{ color: 'var(--google-blue)' }}>
                        <span className="num">{ana.score_total}</span>
                        <span className="lbl">Score Global</span>
                      </div>
                      <div className="ai-stat-big" style={{ color: 'var(--google-green)' }}>
                        <span className="num">{ana.win_probability}%</span>
                        <span className="lbl">Prob. Ganar</span>
                      </div>
                      <div className="ai-stat-big" style={{ color: 'var(--google-yellow)' }}>
                        <span className="num">{ana.score_tech}</span>
                        <span className="lbl">Técnico</span>
                      </div>
                    </div>

                    <div style={{ marginBottom: '2rem' }}>
                      <h4 style={{ marginBottom: '0.5rem' }}>Resumen Ejecutivo</h4>
                      <p style={{ color: 'var(--text-secondary)' }}>{ana.summary}</p>
                    </div>

                    <div className="ai-lists">
                      <div className="ai-list-col opps">
                        <h4 style={{ color: 'var(--google-green)' }}>Oportunidades Clave</h4>
                        <ul>
                          {ana.opportunities?.map((opp, i) => <li key={i}>{opp}</li>)}
                        </ul>
                      </div>
                      <div className="ai-list-col risks">
                        <h4 style={{ color: 'var(--google-red)' }}>Riesgos y Red Flags</h4>
                        <ul>
                          {ana.red_flags?.map((rf, i) => <li key={`rf-${i}`}>{rf}</li>)}
                          {ana.risks?.map((r, i) => <li key={`r-${i}`}>{r}</li>)}
                        </ul>
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ padding: '2rem', textAlign: 'center', background: 'var(--bg-surface-variant)', borderRadius: 'var(--radius-lg)' }}>
                  <p style={{ color: 'var(--text-muted)' }}>La inteligencia artificial aún no ha analizado los documentos de esta licitación.</p>
                </div>
              )}

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
