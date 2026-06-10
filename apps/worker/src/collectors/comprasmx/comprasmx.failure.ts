import { createModuleLogger } from "../../core/logger";

const log = createModuleLogger("comprasmx-failure");

export type ComprasMxFailureOrigin =
  | "COMPRASMX"
  | "OUR_SCRAPER"
  | "NETWORK_INFRA"
  | "SITE_CHANGED"
  | "UNKNOWN";

export type ComprasMxFailureConfidence = "LOW" | "MEDIUM" | "HIGH";
export type ComprasMxFailureSeverity = "INFO" | "WARN" | "DEGRADED" | "CRITICAL";

export interface ComprasMxFailureDiagnosis {
  origin: ComprasMxFailureOrigin;
  category: string;
  confidence: ComprasMxFailureConfidence;
  userDiagnosis: string;
  technicalReason: string;
  recommendedAction: string;
  shouldAlertTelegram: boolean;
  severity: ComprasMxFailureSeverity;
}

export interface ComprasMxFailureContext {
  siteAccessible?: boolean;
  retryAttempted?: boolean;
  retrySucceeded?: boolean;
  consecutiveFailures?: number;
  phase?: string;
  missingConfig?: string[];
}

export class ComprasMxFailureError extends Error {
  constructor(
    message: string,
    readonly diagnosis: ComprasMxFailureDiagnosis,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ComprasMxFailureError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isComprasMxUnauthorized(error: unknown): boolean {
  const message = errorMessage(error);
  return /\b(?:status|http|api)\s*401\b/i.test(message) ||
    /\b401\b.*\bunauthorized\b/i.test(message) ||
    /\bunauthorized\b.*\b401\b/i.test(message);
}

export function classifyComprasMxFailure(
  error: unknown,
  context: ComprasMxFailureContext = {},
): ComprasMxFailureDiagnosis {
  const message = errorMessage(error);
  const normalized = message.toLowerCase();
  const technicalReason = [
    context.phase ? `phase=${context.phase}` : null,
    `error=${message}`,
    context.siteAccessible !== undefined
      ? `siteAccessible=${context.siteAccessible}`
      : null,
  ].filter(Boolean).join("; ");

  if ((context.missingConfig?.length ?? 0) > 0 ||
      /missing|required|faltan?|no source_id|environment|env var|config/i.test(normalized)) {
    return {
      origin: "OUR_SCRAPER",
      category: "LOCAL_CONFIG_ERROR",
      confidence: "HIGH",
      userDiagnosis: "Diagnóstico probable: error de configuración del sistema, no de ComprasMX.",
      technicalReason,
      recommendedAction: "Revisar variables de entorno, URLs base, Supabase, Telegram y credenciales internas.",
      shouldAlertTelegram: true,
      severity: "CRITICAL",
    };
  }

  if (isComprasMxUnauthorized(error)) {
    if (context.retrySucceeded) {
      return {
        origin: "COMPRASMX",
        category: "RECOVERED_TRANSIENT_401",
        confidence: "HIGH",
        userDiagnosis: "Diagnóstico probable: falla temporal de sesión en ComprasMX. No parece error del sistema.",
        technicalReason,
        recommendedAction: "Continuar el flujo normal y conservar el evento solo en logs.",
        shouldAlertTelegram: false,
        severity: "INFO",
      };
    }

    const persistent = (context.consecutiveFailures ?? 0) >= 3;
    return {
      origin: "COMPRASMX",
      category: persistent
        ? "PERSISTENT_AUTH_401"
        : "TRANSIENT_AUTH_OR_SESSION_401",
      confidence: persistent ? "MEDIUM" : "MEDIUM",
      userDiagnosis: persistent
        ? "Diagnóstico probable: ComprasMX está rechazando la sesión/API de consulta. Puede ser intermitencia del portal o cambio de autorización."
        : "Diagnóstico probable: intermitencia de sesión/autorización de ComprasMX. El radar sigue vivo.",
      technicalReason,
      recommendedAction: persistent
        ? "Mantener el collector activo y revisar si el portal cambió su autorización si la degradación continúa."
        : "Recrear la sesión del navegador y reintentar una sola vez.",
      shouldAlertTelegram: persistent,
      severity: persistent ? "DEGRADED" : "WARN",
    };
  }

  const structurePatterns = [
    /selector/,
    /bot[oó]n .*no encontrado/,
    /waitforselector/,
    /no se captur[oó] respuesta/,
    /json inv[aá]lido/,
    /estructura inesperada/,
    /cannot read propert/,
    /parse/,
    /locator/,
  ];
  if (structurePatterns.some((pattern) => pattern.test(normalized))) {
    return {
      origin: "SITE_CHANGED",
      category: "SCRAPER_OR_SITE_STRUCTURE_CHANGED",
      confidence: "MEDIUM",
      userDiagnosis: "Diagnóstico probable: cambió la estructura de ComprasMX o el scraper ya no está encontrando los elementos esperados.",
      technicalReason,
      recommendedAction: "Revisar selectores, endpoint y parseo de la respuesta de ComprasMX.",
      shouldAlertTelegram: true,
      severity: "CRITICAL",
    };
  }

  const infrastructurePatterns = [
    /timeout/,
    /timed out/,
    /econnreset/,
    /econnrefused/,
    /enotfound/,
    /dns/,
    /net::err/,
    /fetch failed/,
    /browser.*(?:closed|crash|launch)/,
    /chromium/,
    /playwright/,
    /out of memory/,
    /\boom\b/,
    /railway/,
    /certificate/,
    /\btls\b/,
  ];
  if (infrastructurePatterns.some((pattern) => pattern.test(normalized))) {
    const repeated = (context.consecutiveFailures ?? 0) >= 3;
    return {
      origin: "NETWORK_INFRA",
      category: "INFRA_OR_BROWSER_FAILURE",
      confidence: "MEDIUM",
      userDiagnosis: "Diagnóstico probable: problema de infraestructura, red o navegador del servidor.",
      technicalReason,
      recommendedAction: "Revisar conectividad, DNS, memoria, Railway y disponibilidad de Playwright/Chromium.",
      shouldAlertTelegram: repeated,
      severity: repeated ? "DEGRADED" : "WARN",
    };
  }

  return {
    origin: "UNKNOWN",
    category: "UNKNOWN_COMPRASMX_FAILURE",
    confidence: "LOW",
    userDiagnosis: "Diagnóstico no concluyente: se requiere revisar la evidencia técnica del fallo.",
    technicalReason,
    recommendedAction: "Revisar logs, respuesta HTTP y estado del navegador antes de atribuir la causa.",
    shouldAlertTelegram: (context.consecutiveFailures ?? 0) >= 3,
    severity: (context.consecutiveFailures ?? 0) >= 3 ? "DEGRADED" : "WARN",
  };
}

export interface ComprasMxCleanSessionRetryResult<T> {
  value: T;
  retryPerformed: boolean;
  recoveredFromTransient401: boolean;
  recoveryDiagnosis?: ComprasMxFailureDiagnosis;
}

export async function withComprasMxCleanSessionRetry<T>(
  runSession: (forceBrowser: boolean) => Promise<T>,
): Promise<ComprasMxCleanSessionRetryResult<T>> {
  try {
    return {
      value: await runSession(false),
      retryPerformed: false,
      recoveredFromTransient401: false,
    };
  } catch (error) {
    if (!isComprasMxUnauthorized(error)) throw error;

    log.warn(
      { error: errorMessage(error) },
      "ComprasMX 401 transitorio detectado",
    );
    log.warn("Recreando sesión navegador por 401");

    try {
      const value = await runSession(true);
      const recoveryDiagnosis = classifyComprasMxFailure(error, {
        retryAttempted: true,
        retrySucceeded: true,
      });
      log.warn(
        { category: recoveryDiagnosis.category },
        "ComprasMX 401 transitorio recuperado con nueva sesión",
      );
      return {
        value,
        retryPerformed: true,
        recoveredFromTransient401: true,
        recoveryDiagnosis,
      };
    } catch (retryError) {
      if (isComprasMxUnauthorized(retryError)) {
        log.warn(
          { error: errorMessage(retryError) },
          "ComprasMX 401 persistente después de reintento",
        );
      }
      throw retryError;
    }
  }
}
