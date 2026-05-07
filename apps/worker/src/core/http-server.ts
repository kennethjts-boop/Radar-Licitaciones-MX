/**
 * HTTP SERVER — Expone endpoints de salud, topes financieros y fichas de licitaciones.
 * Puerto: HEALTH_PORT (default 8080).
 *
 * Rutas:
 *   GET  /health
 *   GET  /api/topes/federales?anio=&tipo=&presupuesto_autorizado=
 *   POST /api/licitaciones/evaluar-modalidad
 *   GET  /api/licitaciones/:id/ficha          (auth: x-api-key)
 *   GET  /api/licitaciones/recientes?limite=&radar=&estado=  (auth: x-api-key)
 */
import http from "node:http";
import { createModuleLogger } from "./logger";
import { getConfig } from "../config/env";
import { getSupabaseClient } from "../storage/client";
import { consultarTopes, evaluarModalidad } from "../topes/topes.service";
import type { TipoContratacion } from "../topes/topes.types";

const log = createModuleLogger("http-server");

const TIPOS_VALIDOS = new Set<TipoContratacion>([
  "adquisicion",
  "arrendamiento",
  "obra_publica",
]);

// ── Tipos de enriquecimiento ──────────────────────────────────────────────────

type EnrichmentStore = {
  ceiling?: {
    directCeiling: number | null;
    estimatedMin: number | null;
    estimatedMax: number | null;
    average: number | null;
    confidence: string;
    explanation: string;
    legalWarning: string;
  } | null;
  similar?: Array<{
    procedureId: string | null;
    source: string;
    title: string | null;
    similarityScore: number;
    awardedAmount: number | null;
    year: number | null;
  }> | null;
};

export function mapEnrichmentToSections(enrichmentData: unknown): {
  techo: unknown;
  antecedentes: unknown;
} {
  if (
    enrichmentData === null ||
    enrichmentData === undefined ||
    typeof enrichmentData !== "object"
  ) {
    return {
      techo: { disponible: false, nota: "Enriquecimiento pendiente" },
      antecedentes: { disponible: false, nota: "Enriquecimiento pendiente" },
    };
  }

  const ed = enrichmentData as EnrichmentStore;

  const techo =
    ed.ceiling != null
      ? {
          disponible: true,
          directCeiling: ed.ceiling.directCeiling,
          estimatedMin: ed.ceiling.estimatedMin,
          estimatedMax: ed.ceiling.estimatedMax,
          average: ed.ceiling.average,
          confidence: ed.ceiling.confidence,
          explanation: ed.ceiling.explanation,
          legalWarning: ed.ceiling.legalWarning,
        }
      : { disponible: false, nota: "Enriquecimiento pendiente" };

  const antecedentes =
    Array.isArray(ed.similar)
      ? {
          disponible: true,
          totalSimilares: ed.similar.length,
          contratos: ed.similar.slice(0, 5),
        }
      : { disponible: false, nota: "Enriquecimiento pendiente" };

  return { techo, antecedentes };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown,
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new Error("JSON inválido en el cuerpo de la petición"));
      }
    });
    req.on("error", reject);
  });
}

async function handleGetTopes(
  url: URL,
  res: http.ServerResponse,
): Promise<void> {
  const anioStr = url.searchParams.get("anio");
  const tipoStr = url.searchParams.get("tipo");
  const presupuestoStr = url.searchParams.get("presupuesto_autorizado");

  if (!anioStr || !tipoStr || !presupuestoStr) {
    sendJson(res, 400, {
      error: "Parámetros requeridos: anio, tipo, presupuesto_autorizado",
    });
    return;
  }

  if (!TIPOS_VALIDOS.has(tipoStr as TipoContratacion)) {
    sendJson(res, 400, {
      error: `tipo inválido. Valores permitidos: ${[...TIPOS_VALIDOS].join(", ")}`,
    });
    return;
  }

  const anio = parseInt(anioStr, 10);
  const presupuesto = parseInt(presupuestoStr, 10);

  if (isNaN(anio) || isNaN(presupuesto) || anio < 2020 || presupuesto < 0) {
    sendJson(res, 400, {
      error:
        "anio debe ser un entero >= 2020 y presupuesto_autorizado debe ser >= 0",
    });
    return;
  }

  const tope = await consultarTopes(
    anio,
    tipoStr as TipoContratacion,
    presupuesto,
  );

  const response: Record<string, unknown> = {
    anio: tope.anio,
    tipo: tope.tipo,
    presupuesto_autorizado: presupuesto,
    tope_adjudicacion: tope.tope_adjudicacion_miles * 1000,
    tope_invitacion: tope.tope_invitacion_miles * 1000,
    fuente: tope.fuente,
  };
  if (
    tope.tope_adjudicacion_srob_miles !== null &&
    tope.tope_invitacion_srob_miles !== null
  ) {
    response.tope_adjudicacion_servicios =
      tope.tope_adjudicacion_srob_miles * 1000;
    response.tope_invitacion_servicios =
      tope.tope_invitacion_srob_miles * 1000;
  }
  sendJson(res, 200, response);
}

async function handlePostEvaluarModalidad(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: unknown;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 400, { error: "Cuerpo JSON inválido" });
    return;
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    sendJson(res, 400, { error: "El body debe ser un objeto JSON" });
    return;
  }

  const b = body as Record<string, unknown>;
  const monto = typeof b.monto === "number" ? b.monto : null;
  const tipoRaw = typeof b.tipo === "string" ? b.tipo : null;
  const presupuesto =
    typeof b.presupuesto_autorizado === "number"
      ? b.presupuesto_autorizado
      : null;

  if (monto === null || tipoRaw === null || presupuesto === null) {
    sendJson(res, 400, {
      error:
        "Campos requeridos: monto (number), tipo (string), presupuesto_autorizado (number)",
    });
    return;
  }

  if (monto < 0) {
    sendJson(res, 400, { error: "monto debe ser >= 0" });
    return;
  }

  if (!TIPOS_VALIDOS.has(tipoRaw as TipoContratacion)) {
    sendJson(res, 400, {
      error: `tipo inválido. Valores permitidos: ${[...TIPOS_VALIDOS].join(", ")}`,
    });
    return;
  }

  const anio =
    typeof b.anio === "number" ? b.anio : new Date().getFullYear();
  const incluyeIva =
    typeof b.incluye_iva === "boolean" ? b.incluye_iva : false;

  const result = await evaluarModalidad({
    monto,
    tipo: tipoRaw as TipoContratacion,
    presupuestoAutorizado: presupuesto,
    anio,
    incluyeIva,
  });

  sendJson(res, 200, {
    modalidad_probable: result.modalidad,
    monto_sin_iva: result.montoSinIva,
    tope_adjudicacion: result.topeAdjudicacion,
    tope_invitacion: result.topeInvitacion,
    analisis: result.analisis,
  });
}

// ── Handlers: fichas de licitaciones ─────────────────────────────────────────

async function handleGetFicha(
  id: string,
  res: http.ServerResponse,
): Promise<void> {
  const db = getSupabaseClient();
  const FICHA_SELECT = [
    "id", "title", "dependency_name", "buying_unit", "licitation_number",
    "expediente_id", "procedure_number", "status", "amount", "currency",
    "publication_date", "opening_date", "award_date", "state", "source_url",
  ].join(", ");

  const { data: raw, error } = await db
    .from("procurements")
    .select(FICHA_SELECT)
    .or(
      `external_id.ilike.%${id}%,` +
      `licitation_number.ilike.%${id}%,` +
      `procedure_number.ilike.%${id}%`,
    )
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!raw) {
    sendJson(res, 404, { error: "No encontrada" });
    return;
  }

  // Supabase no infiere tipos en selects dinámicos; cast explícito.
  const data = raw as unknown as Record<string, unknown>;

  // enrichment_data is intentionally NOT in FICHA_SELECT — the column does not
  // exist in the DB schema yet. Reading it here returns undefined, and
  // mapEnrichmentToSections() returns the "Enriquecimiento pendiente" fallback.
  // Add "enrichment_data" to FICHA_SELECT once the column is migrated.
  const enrichmentRaw = data["enrichment_data"] ?? null;
  const { techo, antecedentes } = mapEnrichmentToSections(enrichmentRaw);

  sendJson(res, 200, {
    ficha: {
      id: data["id"],
      titulo: data["title"],
      dependencia: data["dependency_name"],
      unidad_compradora: data["buying_unit"],
      numero_licitacion: data["licitation_number"],
      numero_expediente: data["expediente_id"],
      procedimiento: data["procedure_number"],
      estado: data["status"],
      monto: data["amount"],
      moneda: data["currency"],
      fecha_publicacion: data["publication_date"],
      fecha_apertura: data["opening_date"],
      fecha_limite: data["award_date"],
      entidad_federativa: data["state"],
      url_convocatoria: data["source_url"],
    },
    techo,
    antecedentes,
    riesgo: { disponible: false, nota: "Módulo en desarrollo" },
    generado_en: new Date().toISOString(),
  });
}

async function handleGetRecientes(
  url: URL,
  res: http.ServerResponse,
): Promise<void> {
  const limiteParam = parseInt(url.searchParams.get("limite") ?? "20", 10);
  const clampedLimit = Math.min(50, Math.max(1, isNaN(limiteParam) ? 20 : limiteParam));
  const radarFilter = url.searchParams.get("radar")?.trim() || null;
  const estadoFilter = url.searchParams.get("estado")?.trim() || null;

  const db = getSupabaseClient();

  // Fetch recent matches with embedded radar key and procurement data.
  // Fetch extra rows to absorb deduplication by procurement_id.
  const { data: rows, error } = await db
    .from("matches")
    .select(
      "match_score, " +
      "radars(key), " +
      "procurements!inner(id, title, dependency_name, status, amount, publication_date)",
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(200, clampedLimit * 6));

  if (error) throw error;

  const seen = new Set<string>();
  const licitaciones: unknown[] = [];

  for (const row of (rows ?? []) as unknown as Record<string, unknown>[]) {
    const proc = row["procurements"] as Record<string, unknown> | null;
    if (!proc?.["id"]) continue;
    const procId = String(proc["id"]);

    const radarKey = (row["radars"] as Record<string, unknown> | null)?.["key"] as string | null ?? null;

    // Client-side filters
    if (radarFilter && (!radarKey || !radarKey.toLowerCase().includes(radarFilter.toLowerCase()))) continue;
    if (estadoFilter) {
      const st = (proc["status"] as string | null) ?? "";
      if (!st.toLowerCase().includes(estadoFilter.toLowerCase())) continue;
    }

    if (seen.has(procId)) continue;
    seen.add(procId);

    licitaciones.push({
      id: procId,
      titulo: proc["title"] ?? null,
      dependencia: proc["dependency_name"] ?? null,
      estado: proc["status"] ?? null,
      monto: proc["amount"] ?? null,
      fecha_publicacion: proc["publication_date"] ?? null,
      radar_key: radarKey,
      score: (row["match_score"] as number | null) ?? null,
    });

    if (licitaciones.length >= clampedLimit) break;
  }

  sendJson(res, 200, {
    total: licitaciones.length,
    licitaciones,
    generado_en: new Date().toISOString(),
  });
}

// ── Router ────────────────────────────────────────────────────────────────────

function isAuthorized(req: http.IncomingMessage): boolean {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) return false; // endpoints deshabilitados si no hay token configurado
  return req.headers["x-internal-token"] === token;
}

function isApiKeyAuthorized(req: http.IncomingMessage): boolean {
  const key = getConfig().INTERNAL_API_KEY;
  if (!key) return false;
  return req.headers["x-api-key"] === key;
}

export function createHttpServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    log.debug({ method: req.method, path: url.pathname }, "HTTP request");

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok", ts: new Date().toISOString() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/topes/federales") {
        if (!isAuthorized(req)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        await handleGetTopes(url, res);
        return;
      }

      if (
        req.method === "POST" &&
        url.pathname === "/api/licitaciones/evaluar-modalidad"
      ) {
        if (!isAuthorized(req)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        await handlePostEvaluarModalidad(req, res);
        return;
      }

      // GET /api/licitaciones/recientes  (antes del patrón /:id/ficha)
      if (req.method === "GET" && url.pathname === "/api/licitaciones/recientes") {
        if (!isApiKeyAuthorized(req)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        await handleGetRecientes(url, res);
        return;
      }

      // GET /api/licitaciones/:id/ficha
      const fichaMatch = url.pathname.match(/^\/api\/licitaciones\/(.+)\/ficha$/);
      if (req.method === "GET" && fichaMatch) {
        if (!isApiKeyAuthorized(req)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const id = decodeURIComponent(fichaMatch[1]);
        await handleGetFicha(id, res);
        return;
      }

      sendJson(res, 404, { error: "Ruta no encontrada" });
    } catch (err) {
      log.error({ err, path: url.pathname }, "Error no manejado en HTTP server");
      sendJson(res, 500, { error: "Error interno del servidor" });
    }
  });
}

export function startHttpServer(): void {
  const config = getConfig();
  const port = config.HEALTH_PORT;
  const server = createHttpServer();
  server.listen(port, () => {
    log.info({ port }, "🌐 HTTP server escuchando");
  });
  server.on("error", (err) => {
    log.error({ err }, "Error fatal en HTTP server");
  });
}
