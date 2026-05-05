import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { Shield, Search, FileText, AlertTriangle, ExternalLink, Calendar, MapPin, Building, Trophy, Filter } from 'lucide-react';
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

interface Analysis {
  id: string;
  attachment_id: string;
  score_total: number;
  win_probability: number;
  category_detected: string;
  is_relevant: boolean;
  summary: string;
}

function App() {
  const [procurements, setProcurements] = useState<Procurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterState, setFilterState] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('procurements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setProcurements(data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
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
            <button className="btn btn-primary">
              <Trophy size={18} /> Ver Oportunidades VIP
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
            <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => {setSearchTerm(''); setFilterState('');}}>
              Limpiar Filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProcurements.map((procurement, index) => (
              <div 
                key={procurement.id} 
                className="glass-card flex flex-col justify-between animate-fade-in"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
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
                    {procurement.state && (
                      <div className="text-muted" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <MapPin size={14} /> {procurement.state}
                      </div>
                    )}
                  </div>
                </div>
                
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
                  <a 
                    href={procurement.source_url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="btn btn-secondary"
                    style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}
                  >
                    Ver Origen <ExternalLink size={14} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
