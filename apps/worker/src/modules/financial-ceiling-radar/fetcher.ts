/**
 * COMPRANET FETCHER — Consulta fuentes públicas de CompraNet / ComprasMX.
 *
 * REGLAS LEGALES ESTRICTAS:
 * - Solo fuentes públicas y legales.
 * - Si hay captcha, login o bloqueo: detenerse y marcar como "requiere revisión manual".
 * - NO evadir captchas.
 * - NO usar credenciales ajenas.
 * - NO acceder a propuestas económicas privadas antes del fallo.
 * - NO hacer scraping agresivo (rate limiting, delays entre requests).
 */

import axios, { AxiosError } from "axios";
import { createModuleLogger } from "../../core/logger";
import { PublicContractRaw, SourceConsulted } from "./types";

const log = createModuleLogger("financial-ceiling:compranet");

// ─── Rate limiting seguro ─────────────────────────────────────────────────────

const DELAY_BETWEEN_REQUESTS_MS = 2000; // 2s entre requests (ético)
const REQUEST_TIMEOUT_MS = 15000;       // 15s timeout máximo

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Headers seguros ──────────────────────────────────────────────────────────

const SAFE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; RadarLicitacionesMX/1.0; +https://radar-licitaciones.mx; investigacion-publica)",
  Accept: "application/json, text/html, */*",
  "Accept-Language": "es-MX,es;q=0.9",
};

// ─── API pública de CompraNet (Hacienda) ──────────────────────────────────────

const COMPRANET_API_BASE =
  "https://upcp-compranet.hacienda.gob.mx/siete/ws/public/convenio";

const COMPRASMX_API_BASE =
  "https://comprasmx.buengobierno.gob.mx/siete/ws/public";

/**
 * Busca un expediente en la API pública de CompraNet por número de licitación.
 * Retorna datos crudos del primer resultado encontrado.
 */
export async function fetchFromCompranet(
  tenderNumber: string,
): Promise<{ data: PublicContractRaw | null; source: SourceConsulted }> {
  const url = `${COMPRASMX_API_BASE}/convenio/search?query=${encodeURIComponent(tenderNumber)}&page=0&size=5`;
  const consultedAt = new Date().toISOString();

  const source: SourceConsulted = {
    url,
    document: "ComprasMX API Pública",
    consultedAt,
    relevantFragment: null,
    status: "ok",
  };

  try {
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
    const resp = await axios.get(url, {
      headers: SAFE_HEADERS,
      timeout: REQUEST_TIMEOUT_MS,
    });

    const body = resp.data;

    // Detectar respuesta de login/captcha
    if (
      typeof body === "string" &&
      (body.includes("captcha") ||
        body.includes("login") ||
        body.includes("autenticación"))
    ) {
      source.status = "captcha";
      source.errorReason = "La fuente requiere autenticación o captcha — revisión manual necesaria";
      log.warn({ url }, "Fuente requiere captcha/login — deteniendo intento");
      return { data: null, source };
    }

    // Intentar extraer datos del primer resultado
    const items =
      body?.content ?? body?.results ?? body?.data ?? body?.expedientes ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      source.status = "not_found";
      source.relevantFragment = JSON.stringify(body).slice(0, 200);
      return { data: null, source };
    }

    // Mapear primer resultado al tipo interno
    const item = items[0];
    const mapped: PublicContractRaw = {
      numero_licitacion: item.numeroExpediente ?? item.numero ?? item.convocatoria ?? null,
      dependencia: item.dependencia ?? item.nombreDependencia ?? null,
      unidad_compradora: item.unidadCompradora ?? item.nombreUC ?? null,
      objeto_contratacion: item.objeto ?? item.descripcion ?? item.titulo ?? null,
      procedimiento: item.tipoProcedimiento ?? item.procedimiento ?? null,
      fecha_publicacion: item.fechaPublicacion ?? item.fechaConvocatoria ?? null,
      fecha_fallo: item.fechaFallo ?? null,
      fecha_contrato: item.fechaContrato ?? null,
      proveedor_ganador: item.proveedor ?? item.razonSocial ?? null,
      monto_contrato: parseMontoMX(item.montoContrato ?? item.monto ?? null),
      monto_maximo: parseMontoMX(item.montoMaximo ?? null),
      monto_minimo: parseMontoMX(item.montoMinimo ?? null),
      presupuesto_autorizado: parseMontoMX(item.presupuestoAutorizado ?? null),
      moneda: item.moneda ?? "MXN",
      url_fuente: item.urlDetalle ?? url,
      nombre_documento: "ComprasMX — Expediente público",
      texto_evidencia: JSON.stringify(item).slice(0, 500),
    };

    source.relevantFragment = mapped.objeto_contratacion ?? "Objeto no identificado";
    return { data: mapped, source };
  } catch (err) {
    const axErr = err as AxiosError;
    if (axErr.response?.status === 403 || axErr.response?.status === 401) {
      source.status = "blocked";
      source.errorReason = `HTTP ${axErr.response.status} — Acceso denegado`;
    } else if (axErr.code === "ECONNABORTED") {
      source.status = "error";
      source.errorReason = "Timeout de conexión";
    } else {
      source.status = "error";
      source.errorReason = axErr.message ?? "Error desconocido";
    }
    log.warn(
      { 
        url, 
        err: source.errorReason, 
        durationMs: Date.now() - Date.parse(consultedAt) 
      }, 
      "Error consultando ComprasMX"
    );
    return { data: null, source };
  }
}

/**
 * Busca contratos históricos similares en CompraNet por dependencia + palabras clave.
 * Retorna hasta 10 candidatos para scoring.
 */
export async function fetchHistoricalContracts(params: {
  agency?: string | null;
  keywords: string[];
  year?: number | null;
}): Promise<{ data: PublicContractRaw[]; source: SourceConsulted }> {
  const keywordStr = params.keywords.slice(0, 5).join(" ");
  const agencyParam = params.agency ?? "";

  const url = `${COMPRASMX_API_BASE}/convenio/search?query=${encodeURIComponent(keywordStr + " " + agencyParam)}&page=0&size=10`;
  const consultedAt = new Date().toISOString();

  const source: SourceConsulted = {
    url,
    document: "ComprasMX — Búsqueda histórica",
    consultedAt,
    relevantFragment: null,
    status: "ok",
  };

  try {
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
    const resp = await axios.get(url, {
      headers: SAFE_HEADERS,
      timeout: REQUEST_TIMEOUT_MS,
    });

    const body = resp.data;

    if (typeof body === "string" && body.includes("captcha")) {
      source.status = "captcha";
      source.errorReason = "Captcha detectado — revisión manual";
      return { data: [], source };
    }

    const items =
      body?.content ?? body?.results ?? body?.data ?? body?.expedientes ?? [];
    if (!Array.isArray(items)) {
      source.status = "not_found";
      return { data: [], source };
    }

    const mapped: PublicContractRaw[] = items.map((item: Record<string, unknown>) => ({
      numero_licitacion: String(item.numeroExpediente ?? item.numero ?? ""),
      dependencia: String(item.dependencia ?? item.nombreDependencia ?? ""),
      unidad_compradora: String(item.unidadCompradora ?? item.nombreUC ?? ""),
      objeto_contratacion: String(item.objeto ?? item.descripcion ?? item.titulo ?? ""),
      fecha_contrato: String(item.fechaContrato ?? item.fechaFallo ?? ""),
      proveedor_ganador: String(item.proveedor ?? item.razonSocial ?? ""),
      monto_contrato: parseMontoMX(item.montoContrato ?? item.monto ?? null),
      monto_maximo: parseMontoMX(item.montoMaximo ?? null),
      moneda: String(item.moneda ?? "MXN"),
      url_fuente: String(item.urlDetalle ?? url),
      nombre_documento: "ComprasMX — Contrato histórico",
      texto_evidencia: JSON.stringify(item).slice(0, 300),
    }));

    source.relevantFragment = `${items.length} contratos encontrados`;
    return { data: mapped, source };
  } catch (err) {
    const axErr = err as AxiosError;
    source.status = "error";
    source.errorReason = axErr.message ?? "Error desconocido";
    log.warn({ url, err: source.errorReason }, "Error buscando histórico");
    return { data: [], source };
  }
}

/**
 * Intenta consultar la Plataforma Nacional de Transparencia (PNT) por número de expediente.
 * Solo si es acceso público — detiene si detecta login.
 */
export async function fetchFromPNT(
  query: string,
): Promise<{ data: PublicContractRaw | null; source: SourceConsulted }> {
  // PNT portal de búsqueda pública
  const url = `https://www.plataformadetransparencia.org.mx/web/guest/obligaciones-de-transparencia?p_p_id=PNT_WAR_pntportlet&_PNT_WAR_pntportlet_query=${encodeURIComponent(query)}`;
  const consultedAt = new Date().toISOString();

  const source: SourceConsulted = {
    url,
    document: "Plataforma Nacional de Transparencia",
    consultedAt,
    relevantFragment: null,
    status: "ok",
  };

  try {
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
    const resp = await axios.get(url, {
      headers: SAFE_HEADERS,
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 3,
    });

    const html = typeof resp.data === "string" ? resp.data : "";

    // Verificar que no sea página de login
    if (
      html.includes("Iniciar sesión") ||
      html.includes("login") ||
      html.toLowerCase().includes("captcha")
    ) {
      source.status = "captcha";
      source.errorReason = "PNT requiere autenticación para este recurso";
      return { data: null, source };
    }

    // Búsqueda básica de montos en HTML público
    const montoMatch = html.match(/\$[\s]*([\d,]+(?:\.\d{2})?)/);
    if (montoMatch) {
      source.relevantFragment = `Monto encontrado: ${montoMatch[0]}`;
    } else {
      source.status = "not_found";
      source.relevantFragment = "Sin monto público encontrado";
    }

    return { data: null, source }; // PNT requiere parsing más sofisticado
  } catch (err) {
    const axErr = err as AxiosError;
    source.status = "error";
    source.errorReason = axErr.message ?? "Error";
    log.warn({ url, err: source.errorReason }, "Error consultando PNT");
    return { data: null, source };
  }
}

// ─── Utilidad ─────────────────────────────────────────────────────────────────

function parseMontoMX(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[$,\s]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}
