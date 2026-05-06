// Mock data for Radar Licitaciones MX prototypes
// (Real data shape matches the scraped licitación format)

window.RL_DATA = {
  stats: {
    total: 12847,
    activas: 4291,
    monto_total: 89_420_000_000, // MXN
    nuevas_hoy: 142,
    cerrando_24h: 38,
  },
  estados: [
    { code: 'CMX', name: 'Ciudad de México', count: 1842, monto: 24_100_000_000 },
    { code: 'JAL', name: 'Jalisco', count: 612, monto: 8_400_000_000 },
    { code: 'NLE', name: 'Nuevo León', count: 587, monto: 9_120_000_000 },
    { code: 'OAX', name: 'Oaxaca', count: 421, monto: 3_800_000_000 },
    { code: 'TAB', name: 'Tabasco', count: 298, monto: 4_200_000_000 },
    { code: 'DUR', name: 'Durango', count: 187, monto: 1_900_000_000 },
    { code: 'QRO', name: 'Quintana Roo', count: 234, monto: 2_700_000_000 },
    { code: 'VER', name: 'Veracruz', count: 367, monto: 5_800_000_000 },
    { code: 'CHH', name: 'Chihuahua', count: 312, monto: 4_900_000_000 },
    { code: 'YUC', name: 'Yucatán', count: 198, monto: 2_100_000_000 },
  ],
  dependencias: ['IMSS', 'ISSSTE', 'SEDENA', 'CONAGUA', 'BANOBRAS', 'PEMEX', 'CFE', 'SAT', 'SEP', 'IMP'],
  licitaciones: [
    { id: 'LA-50-GYR-050GYR010-N-50-2026', titulo: 'Servicio de mantenimiento preventivo y correctivo a equipos de hemodiálisis', dep: 'IMSS', estado: 'OAX', estadoFull: 'Oaxaca', status: 'activa', fecha: '05 may 2026', cierra: '12 may 2026', monto: null, montoLabel: 'Abierto', tipo: 'Servicios', ofertas: 7, nuevo: true },
    { id: 'LA-50-GYR-050GYR011-N-50-2026', titulo: '"Servicio médico integral para hemodinamia y cardiología intervencionista"', dep: 'IMSS', estado: 'OAX', estadoFull: 'Oaxaca', status: 'activa', fecha: '05 may 2026', cierra: '14 may 2026', monto: 48_200_000, montoLabel: '$48.2M', tipo: 'Servicios', ofertas: 4, nuevo: true },
    { id: 'AA-50-GYR-050GYR012-N-50-2026', titulo: 'Adquisición de refacciones de electricidad, ejercicio fiscal 2026', dep: 'IMSS', estado: 'OAX', estadoFull: 'Oaxaca', status: 'activa', fecha: '05 may 2026', cierra: '18 may 2026', monto: 12_800_000, montoLabel: '$12.8M', tipo: 'Adquisición', ofertas: 12 },
    { id: 'LA-50-GYR-050GYR013-N-50-2026', titulo: 'Servicio médico integral hemodiálisis interna del 01 de junio al 31 de diciembre 2026', dep: 'IMSS', estado: 'TAB', estadoFull: 'Tabasco', status: 'activa', fecha: '05 may 2026', cierra: '20 may 2026', monto: 96_500_000, montoLabel: '$96.5M', tipo: 'Servicios', ofertas: 9 },
    { id: 'OA-50-GYR-NL-014', titulo: 'Reparación de acabados e instalaciones en el vestidor de hombres del HGZ #2', dep: 'IMSS', estado: 'NLE', estadoFull: 'Nuevo León', status: 'activa', fecha: '05 may 2026', cierra: '15 may 2026', monto: 3_400_000, montoLabel: '$3.4M', tipo: 'Obra', ofertas: 5 },
    { id: 'LP-06-CMX-2026-015', titulo: 'Elaboración, adecuación y revisión de proyectos ejecutivos para infraestructura hídrica', dep: 'BANOBRAS', estado: 'CMX', estadoFull: 'Ciudad de México', status: 'activa', fecha: '05 may 2026', cierra: '22 may 2026', monto: 28_900_000, montoLabel: '$28.9M', tipo: 'Servicios', ofertas: 14 },
    { id: 'LA-50-GYR-DUR-016', titulo: 'LA-50-GYR-050GYR010-N-50-2026 "Adquisición de material y suministros médicos"', dep: 'IMSS', estado: 'DUR', estadoFull: 'Durango', status: 'activa', fecha: '05 may 2026', cierra: '17 may 2026', monto: 18_700_000, montoLabel: '$18.7M', tipo: 'Adquisición', ofertas: 6 },
    { id: 'LP-19-QRO-2026-017', titulo: 'Servicio médico subrogado de hospitalización', dep: 'ISSSTE', estado: 'QRO', estadoFull: 'Quintana Roo', status: 'activa', fecha: '05 may 2026', cierra: '13 may 2026', monto: 142_300_000, montoLabel: '$142.3M', tipo: 'Servicios', ofertas: 3, alerta: true },
    { id: 'AA-07-SED-CMX-018', titulo: 'Adquisición de diverso material y equipo para fuerzas armadas', dep: 'SEDENA', estado: 'CMX', estadoFull: 'Ciudad de México', status: 'activa', fecha: '05 may 2026', cierra: '25 may 2026', monto: 412_000_000, montoLabel: '$412M', tipo: 'Adquisición', ofertas: 8 },
    { id: 'AA-07-SED-CMX-019', titulo: 'Adquisición de paracaídas', dep: 'SEDENA', estado: 'CMX', estadoFull: 'Ciudad de México', status: 'activa', fecha: '05 may 2026', cierra: '24 may 2026', monto: 67_200_000, montoLabel: '$67.2M', tipo: 'Adquisición', ofertas: 2 },
    { id: 'OA-16-CONAGUA-CMX-020', titulo: 'Supervisión rehabilitación del canal principal el carrizo', dep: 'CONAGUA', estado: 'CMX', estadoFull: 'Ciudad de México', status: 'activa', fecha: '04 may 2026', cierra: '30 may 2026', monto: 23_400_000, montoLabel: '$23.4M', tipo: 'Servicios', ofertas: 11 },
    { id: 'OA-16-CONAGUA-CMX-021', titulo: 'Proyecto para la construcción del canal de protección margen derecho', dep: 'CONAGUA', estado: 'CMX', estadoFull: 'Ciudad de México', status: 'cerrando', fecha: '04 may 2026', cierra: '06 may 2026', monto: 187_600_000, montoLabel: '$187.6M', tipo: 'Obra', ofertas: 16, alerta: true },
  ],
  // Stream of recent events for the live ticker
  stream: [
    { time: '14:42:08', kind: 'new', text: 'Nueva licitación · IMSS Oaxaca · $48.2M' },
    { time: '14:39:51', kind: 'update', text: 'Actualización · CONAGUA CDMX · 4 ofertas recibidas' },
    { time: '14:38:12', kind: 'closing', text: 'Cerrando en 24h · ISSSTE QROO · $142.3M' },
    { time: '14:35:47', kind: 'new', text: 'Nueva licitación · SEDENA CDMX · $412M' },
    { time: '14:31:02', kind: 'award', text: 'Adjudicada · PEMEX Veracruz · $89.1M' },
    { time: '14:28:33', kind: 'new', text: 'Nueva licitación · BANOBRAS CDMX · $28.9M' },
  ],
};
