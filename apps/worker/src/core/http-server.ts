/**
 * HTTP SERVER — Expone endpoints de salud y topes financieros.
 * Puerto: HEALTH_PORT (default 8080).
 *
 * Rutas:
 *   GET  /health
 *   GET  /api/topes/federales?anio=&tipo=&presupuesto_autorizado=
 *   POST /api/licitaciones/evaluar-modalidad
 */
import http from "node:http";
import { createModuleLogger } from "./logger";
import { getConfig } from "../config/env";
import { consultarTopes, evaluarModalidad } from "../topes/topes.service";
import type { TipoContratacion } from "../topes/topes.types";

const log = createModuleLogger("http-server");

const TIPOS_VALIDOS = new Set<TipoContratacion>([
  "adquisicion",
  "arrendamiento",
  "obra_publica",
]);

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

// ── Handlers ──────────────────────────────────────────────────────────────────

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

// ── Router ────────────────────────────────────────────────────────────────────

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
        await handleGetTopes(url, res);
        return;
      }

      if (
        req.method === "POST" &&
        url.pathname === "/api/licitaciones/evaluar-modalidad"
      ) {
        await handlePostEvaluarModalidad(req, res);
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
