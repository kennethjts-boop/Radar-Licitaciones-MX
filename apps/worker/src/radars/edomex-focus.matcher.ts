/**
 * Focos del Estado de México (versión edomex_20261025).
 *
 * Aplica a dos fuentes: los índices oficiales de SECOGEM y los procedimientos
 * de ComprasMX convocados por unidades compradoras estatales (915xxxxxx) o
 * municipales (815xxxxxx / siglas 074xxx) del Estado de México.
 *
 * Cada procedimiento se asigna a lo más a un foco. El monto sólo cuenta si es
 * el presupuesto/monto explícito del contrato: capital contable, costo de
 * bases o inversión global de un programa nunca equivalen al contrato.
 */
import { fromZonedTime } from "date-fns-tz";
import { normalizeText } from "../core/text";
import { MX_TIMEZONE } from "../core/time";
import type { NormalizedProcurement } from "../types/procurement";

export const EDOMEX_FOCUS_KEYS = {
  issemym: "edomex_issemym_20261025",
  carreteras: "edomex_carreteras_20261025",
  sitramytem: "edomex_sitramytem_20261025",
  oportunidades: "edomex_oportunidades_20261025",
  // Prioridades 2026-11-08: BIRMEX nacional y organismos estatales de interés.
  birmex: "birmex_prioridad_20261108",
  difem: "edomex_difem_20261108",
  jcem: "edomex_jcem_20261108",
  salud: "edomex_salud_20261108",
} as const;

export type EdomexFocusKey = (typeof EDOMEX_FOCUS_KEYS)[keyof typeof EDOMEX_FOCUS_KEYS];

/** Debe coincidir con `radar_config_versions.version_key` de la migración 20261025. */
export const EDOMEX_RADAR_VERSION_KEY = "edomex_20261025";
/** Versión de los focos de prioridad (BIRMEX, DIFEM, JCEM, Salud Edomex). */
export const PRIORITY_RADAR_VERSION_KEY = "prioridad_20261108";
const PRIORITY_FOCUS_KEYS: readonly string[] = [
  EDOMEX_FOCUS_KEYS.birmex, EDOMEX_FOCUS_KEYS.difem, EDOMEX_FOCUS_KEYS.jcem, EDOMEX_FOCUS_KEYS.salud,
];
/** Versión de configuración vigente que debe tener cada foco. */
export function expectedFocusVersionKey(radarKey: string): string {
  return PRIORITY_FOCUS_KEYS.includes(radarKey) ? PRIORITY_RADAR_VERSION_KEY : EDOMEX_RADAR_VERSION_KEY;
}
export const SECOGEM_SOURCE_KEY = "secogem_edomex";
/** Activación de los focos: nada publicado antes se alerta como nuevo. */
export const EDOMEX_PUBLICATION_CUTOFF_DATE = "2026-10-25";
export const EDOMEX_PUBLICATION_CUTOFF = fromZonedTime(`${EDOMEX_PUBLICATION_CUTOFF_DATE}T00:00:00`, MX_TIMEZONE);

/** Los focos de prioridad miran 30 días hacia atrás (activación 2026-11-08). */
export const PRIORITY_PUBLICATION_CUTOFF_DATE = "2026-10-09";
export const PRIORITY_PUBLICATION_CUTOFF = fromZonedTime(`${PRIORITY_PUBLICATION_CUTOFF_DATE}T00:00:00`, MX_TIMEZONE);

export const EDOMEX_ROAD_MIN_AMOUNT = 100_000_000;
export const EDOMEX_OTHER_MIN_AMOUNT = 20_000_000;

export type EdomexAmountStatus = "confirmed" | "pending" | "not_required";

export interface EdomexFocusDetection {
  key: EdomexFocusKey;
  amountStatus: EdomexAmountStatus;
  matchedTerms: string[];
  scoreReasons: string[];
  territoryMatched: string;
}

export function isEdomexFocusKey(key: string): key is EdomexFocusKey {
  return (Object.values(EDOMEX_FOCUS_KEYS) as string[]).includes(key);
}

const ISSEMYM = /\bissemy?m\b|instituto de seguridad social del estado de mexico y municipios/;
// BIRMEX: razón social, alias y unidad compradora 012NEF001 (Dirección de Administración y Finanzas).
const BIRMEX = /\bbirmex\b|laboratorios de biologicos y reactivos de mexico|\b012nef001\b/;
// DIFEM estatal: excluye DIF municipales y DIF Nacional (SNDIF).
const DIFEM = /\bdifem\b|desarrollo integral de la familia del estado de mexico/;
const DIF_OTHER = /sistema nacional para el desarrollo integral|\bsndif\b|\bdif municipal\b|desarrollo integral de la familia (?:del )?municipio/;
const JCEM = /\bjcem\b|junta de caminos del estado de mexico|\bsmov jc\b/;
// Salud estatal: ISEM y Secretaría de Salud del Estado de México (no ISSEMyM, IMSS ni salud federal).
const SALUD_EDOMEX = /\bisem\b|instituto de salud del estado de mexico|secretaria de salud del estado de mexico|\bsecretaria de salud\b.*\bestado de mexico\b|\bssem\b/;
const SITRAMYTEM =/\bsitramytem\b|sistema de transporte masivo y teleferico/;
const ROAD = /\b(?:carreteras?|caminos?|vialidad(?:es)?|paviment\w*|repavimentacion|bacheo|asfalt\w*|carriles?|semaforos?|senalamiento|balizamiento|puentes? vehicular\w*)\b/;
const ROAD_PRIORITY = /\b(?:rehabilitacion|conservacion|paviment\w*|repavimentacion|bacheo|mantenimiento)\b/;
const LARGE_ROAD_SCOPE = /\b(?:residencia regional|red carretera|carreteras?|tramo carretero|autopistas?|camino (?:no\.?\s*)?\d+|km\.?\s*\d+)\b/;
const SITRAMYTEM_SCOPE = /\b(?:mantenimiento|conservacion|rehabilitacion|semaforos?|senalamiento|balizamiento|bacheo|paviment\w*|vialidad(?:es)?|carriles?|confinamiento|estaciones?|limpieza|seguridad|vigilancia)\b/;
const BUSINESS = /\b(?:obras?|construccion|rehabilitacion|conservacion|mantenimiento|suministro|adquisicion|arrendamiento|limpieza|vigilancia|seguridad|equipamiento|equipo|vehiculos?|patrullas?|ambulancias?|medicamentos?|material de curacion|software|informat\w*|plataforma|tecnolog\w*|computo|telecomunicaciones|mobiliario|uniformes?|agua potable|drenaje|alumbrado|insumos|suministros|despensas?|combustibles?)\b/;
const LARGE_SCOPE = /\b(?:integral|estatal|hospital\w*|plataforma|flota|parque vehicular|maquinaria|medicamentos|infraestructura|diversos municipios|varios municipios|red de|unidades medicas|consolidad[ao]|plurianual|abierto)\b/;
// Megaobras complejas: se excluyen siempre (salvo ISSEMyM, que no las convoca).
const MEGAPROJECT = /\b(?:llave en mano|concesion\w*|teleferico|viaducto|tunel\w*|proyecto integral|asociacion publico privada)\b|linea\s+\d+\s+del?\s+mexibus|mexicable\s+linea|construccion de la linea|trolebus/;

function raw(procurement: NormalizedProcurement, key: string): string {
  const value = procurement.rawJson[key];
  return typeof value === "string" ? normalizeText(value) : "";
}

function buyerText(p: NormalizedProcurement): string {
  return normalizeText([
    p.dependencyName ?? "", p.buyingUnit ?? "", raw(p, "siglas"), raw(p, "unidad_compradora"),
    raw(p, "dependencia"),
  ].join(" "));
}

function objectText(p: NormalizedProcurement): string {
  return normalizeText([
    p.title, p.description ?? "", raw(p, "nombre_procedimiento"), raw(p, "objeto_contratacion"),
  ].join(" "));
}

/** Unidad compradora estatal o municipal del Estado de México en ComprasMX. */
export function isEdomexLocalBuyer(p: NormalizedProcurement): boolean {
  if (p.source === SECOGEM_SOURCE_KEY) return true;
  if (p.source !== "comprasmx") return false;
  const unit = raw(p, "unidad_compradora") || normalizeText(p.buyingUnit ?? "");
  const siglas = raw(p, "siglas") || normalizeText(p.dependencyName ?? "");
  // Clave de UC: 9 = estatal, 8 = municipal; 15 = Estado de México.
  if (/^(?:915|815)\d{6}\b/.test(unit) || /^074\d{3}\b/.test(unit) || /^074\d{3}$/.test(siglas)) return true;
  return ISSEMYM.test(buyerText(p)) || SITRAMYTEM.test(buyerText(p)) ||
    /\bjunta de caminos del estado de mexico\b/.test(buyerText(p));
}

/** Clasifica un procedimiento; null si no corresponde a ningún foco Edomex. */
export function classifyEdomexProcurement(p: NormalizedProcurement): EdomexFocusDetection | null {
  const priority = classifyPriorityProcurement(p);
  if (priority) return priority;
  if (!isEdomexLocalBuyer(p)) return null;
  const buyer = buyerText(p);
  const object = objectText(p);
  const all = `${buyer} ${object} ${normalizeText(p.procedureNumber ?? "")}`;
  const amount = typeof p.amount === "number" && Number.isFinite(p.amount) && p.amount > 0 ? p.amount : null;
  const territory = p.source === SECOGEM_SOURCE_KEY ? "Estado de México (SECOGEM)" : "Estado de México (ComprasMX)";
  const base = (key: EdomexFocusKey, amountStatus: EdomexAmountStatus, terms: string[], reasons: string[]) => ({
    key, amountStatus, matchedTerms: terms, scoreReasons: reasons, territoryMatched: territory,
  });

  if (ISSEMYM.test(all)) {
    return base(EDOMEX_FOCUS_KEYS.issemym, "not_required", ["ISSEMyM"], ["buyer_issemym", "any_amount"]);
  }
  if (MEGAPROJECT.test(object)) return null;

  const roadWork = ROAD.test(object);
  if (SITRAMYTEM.test(all)) {
    if (!SITRAMYTEM_SCOPE.test(object)) return null;
    // Trabajos carreteros de SITRAMyTEM conservan el mínimo de 100 MDP.
    const highway = /\b(?:carreteras?|autopistas?|tramo carretero)\b/.test(object);
    if (highway && amount !== null && amount <= EDOMEX_ROAD_MIN_AMOUNT) return null;
    return base(EDOMEX_FOCUS_KEYS.sitramytem,
      highway ? (amount !== null ? "confirmed" : "pending") : "not_required",
      ["SITRAMyTEM"], ["buyer_sitramytem", highway ? "highway_min_100m" : "bounded_maintenance"]);
  }

  if (roadWork) {
    if (amount !== null) {
      if (amount <= EDOMEX_ROAD_MIN_AMOUNT) return null;
      return base(EDOMEX_FOCUS_KEYS.carreteras, "confirmed", ["carreteras", "> $100 MDP"],
        ["road_work", "amount_above_100m", ...(ROAD_PRIORITY.test(object) ? ["priority_rehab_paving"] : [])]);
    }
    if (!LARGE_ROAD_SCOPE.test(object)) return null;
    return base(EDOMEX_FOCUS_KEYS.carreteras, "pending", ["carreteras", "monto pendiente"],
      ["road_work", "regional_scope", "amount_pending", ...(ROAD_PRIORITY.test(object) ? ["priority_rehab_paving"] : [])]);
  }

  if (!BUSINESS.test(object)) return null;
  if (amount !== null) {
    if (amount < EDOMEX_OTHER_MIN_AMOUNT) return null;
    return base(EDOMEX_FOCUS_KEYS.oportunidades, "confirmed", ["alto monto", ">= $20 MDP"],
      ["edomex_local_buyer", "amount_at_least_20m"]);
  }
  if (!LARGE_SCOPE.test(object)) return null;
  return base(EDOMEX_FOCUS_KEYS.oportunidades, "pending", ["alcance amplio", "monto pendiente"],
    ["edomex_local_buyer", "large_scope", "amount_pending"]);
}

/**
 * Focos de prioridad. BIRMEX es nacional (cualquier giro, monto y portal);
 * DIFEM, JCEM y Salud estatal toman cualquier procedimiento del organismo
 * convocante. El monto sólo se afirma si consta explícito.
 */
export function classifyPriorityProcurement(p: NormalizedProcurement): EdomexFocusDetection | null {
  const header = `${buyerText(p)} ${normalizeText(p.procedureNumber ?? "")} ${normalizeText(p.licitationNumber ?? "")}`;
  const amount = typeof p.amount === "number" && Number.isFinite(p.amount) && p.amount > 0 ? p.amount : null;
  const make = (key: EdomexFocusKey, status: EdomexAmountStatus, terms: string[], reasons: string[], area: string) =>
    ({ key, amountStatus: status, matchedTerms: terms, scoreReasons: reasons, territoryMatched: area });

  if (BIRMEX.test(header)) {
    return make(EDOMEX_FOCUS_KEYS.birmex, "not_required", ["BIRMEX"], ["buyer_birmex", "priority_max", "any_amount"], "México");
  }
  if (ISSEMYM.test(header)) return null; // el foco ISSEMyM conserva su asignación.
  if (JCEM.test(header)) {
    const reason = amount === null ? "amount_pending" : amount > EDOMEX_ROAD_MIN_AMOUNT ? "amount_above_100m" : "amount_known";
    return make(EDOMEX_FOCUS_KEYS.jcem, amount === null ? "pending" : "confirmed", ["Junta de Caminos"],
      ["buyer_jcem", "any_amount", reason], "Estado de México (Junta de Caminos)");
  }
  if (DIFEM.test(header) && !DIF_OTHER.test(header)) {
    return make(EDOMEX_FOCUS_KEYS.difem, "not_required", ["DIFEM"], ["buyer_difem", "any_amount"], "Estado de México (DIFEM)");
  }
  if (SALUD_EDOMEX.test(header)) {
    const organism = /\bisem\b|instituto de salud/.test(header) ? "ISEM" : "Secretaría de Salud";
    return make(EDOMEX_FOCUS_KEYS.salud, "not_required", [organism], ["buyer_salud_edomex", "any_amount"], "Estado de México (Salud)");
  }
  return null;
}

export function detectEdomexFocus(p: NormalizedProcurement, radarKey: string): EdomexFocusDetection | null {
  if (!isEdomexFocusKey(radarKey)) return null;
  const detection = classifyEdomexProcurement(p);
  return detection?.key === radarKey ? detection : null;
}

/** Los focos Edomex nunca alertan publicaciones anteriores a su activación. */
export function isPublishedOnOrAfterEdomexCutoff(publishedAt: Date | null, radarKey?: string): boolean {
  const cutoff = radarKey && PRIORITY_FOCUS_KEYS.includes(radarKey) ? PRIORITY_PUBLICATION_CUTOFF : EDOMEX_PUBLICATION_CUTOFF;
  return publishedAt === null || publishedAt >= cutoff;
}
