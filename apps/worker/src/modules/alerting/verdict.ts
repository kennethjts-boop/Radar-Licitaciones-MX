import type { CircuitSnapshot } from "../resilience/circuit-breaker";
import type { SaturationAnalysis } from "./saturation";

export type VerdictCategory = "ESPERAR" | "VIGILAR" | "PAUSAR" | "INTERVENIR";

export interface OperationalVerdict {
  category: VerdictCategory;
  reason: string;
  action: string;
  reviewAt: string;
  suggestedPauseMinutes: number | null;
}

export interface VerdictContext {
  source: "watchdog" | "telegram_polling" | "generic" | "main_circuit";
  consecutiveFailures?: number;
  cause?: string | null;
  errorType?: string | null;
  message?: string | null;
  httpStatus?: number;
  telegramConflict?: boolean;
  backoffMs?: number;
  circuit?: CircuitSnapshot | null;
  saturation?: SaturationAnalysis | null;
  defaultPauseMinutes?: number;
}

function minutesRemaining(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

function interventionSignal(context: VerdictContext): boolean {
  if (context.telegramConflict || context.httpStatus === 409) return true;
  if (context.cause === "SITE_STRUCTURE") return true;
  const text = [
    context.cause,
    context.errorType,
    context.message,
  ].filter(Boolean).join(" ").toLowerCase();
  return /credential|credencial|schema|config|missing|required|token|unauthorized|forbidden|401|403|duplicate|duplicad|selector|estructura|site_structure/.test(
    text,
  );
}

export function determineVerdict(
  context: VerdictContext,
): OperationalVerdict {
  const failures = context.consecutiveFailures ?? 1;
  const defaultPause = context.defaultPauseMinutes ?? 60;
  const insufficientHistory = context.saturation &&
      !context.saturation.sufficient
    ? " Sin patrón histórico suficiente."
    : "";

  if (context.telegramConflict || context.httpStatus === 409) {
    return {
      category: "INTERVENIR",
      reason: "Hay otra instancia del bot consumiendo los mismos mensajes.",
      action: "Revisa las réplicas en Railway y deja una sola instancia con polling activo.",
      reviewAt: "Verifica de nuevo después de corregir las réplicas.",
      suggestedPauseMinutes: null,
    };
  }

  if (interventionSignal(context)) {
    return {
      category: "INTERVENIR",
      reason: "El fallo requiere corregir configuración, permisos o estructura del portal.",
      action: "Revisa la configuración y la evidencia técnica antes de reactivar el radar.",
      reviewAt: "Sin acción pendiente automática.",
      suggestedPauseMinutes: null,
    };
  }

  if (context.circuit?.reopenedFromHalfOpen) {
    return {
      category: "PAUSAR",
      reason: "El portal volvió a fallar durante el intento de recuperación.",
      action: `Envía /pausa ${defaultPause} para dejar descansar el portal.`,
      reviewAt: `Revisa en ${defaultPause} minutos.`,
      suggestedPauseMinutes: defaultPause,
    };
  }

  if (
    context.saturation?.sufficient &&
    context.saturation.isPeakHour &&
    failures >= 3
  ) {
    return {
      category: "PAUSAR",
      reason: "Hora de saturación conocida del portal y degradación sostenida.",
      action: `Envía /pausa ${defaultPause} para detener el radar durante la hora pico.`,
      reviewAt: `Revisa en ${defaultPause} minutos.`,
      suggestedPauseMinutes: defaultPause,
    };
  }

  if (
    context.httpStatus !== undefined &&
    context.httpStatus >= 500 &&
    failures >= 3
  ) {
    return {
      category: "PAUSAR",
      reason: "El portal mantiene respuestas de error en ciclos consecutivos.",
      action: `Envía /pausa ${defaultPause} para evitar forzar el servicio.`,
      reviewAt: `Revisa en ${defaultPause} minutos.`,
      suggestedPauseMinutes: defaultPause,
    };
  }

  if (context.saturation?.sufficient && context.saturation.isAnomalous) {
    return {
      category: "VIGILAR",
      reason: "El fallo ocurrió fuera de la hora de saturación habitual; es anómalo.",
      action: "Vigila el siguiente ciclo y revisa los logs si vuelve a ocurrir.",
      reviewAt: "Revisa en 30 minutos.",
      suggestedPauseMinutes: 30,
    };
  }

  if (context.circuit?.state === "OPEN") {
    const minutes = minutesRemaining(context.circuit.msUntilRetry);
    return {
      category: "ESPERAR",
      reason: `La protección automática ya detuvo los intentos; faltan ${minutes} minutos.${insufficientHistory}`,
      action: "Deja que el circuito haga el siguiente sondeo automáticamente.",
      reviewAt: `Revisa en ${minutes} minutos.`,
      suggestedPauseMinutes: minutes,
    };
  }

  if ((context.backoffMs ?? 0) > 0) {
    const minutes = minutesRemaining(context.backoffMs ?? 0);
    return {
      category: "ESPERAR",
      reason: `El reintento automático está en espera durante ${minutes} minutos.`,
      action: "Espera el siguiente intento automático.",
      reviewAt: `Revisa en ${minutes} minutos.`,
      suggestedPauseMinutes: minutes,
    };
  }

  if (failures === 2) {
    return {
      category: "VIGILAR",
      reason: "Ya son dos fallos consecutivos y la degradación podría escalar.",
      action: "Vigila el siguiente ciclo antes de intervenir.",
      reviewAt: "Revisa en 30 minutos.",
      suggestedPauseMinutes: 30,
    };
  }

  if (context.source === "generic") {
    return {
      category: "VIGILAR",
      reason: "El error no tiene todavía evidencia suficiente para atribuir una causa estable.",
      action: "Revisa el siguiente ciclo y la evidencia técnica si se repite.",
      reviewAt: "Revisa en 30 minutos.",
      suggestedPauseMinutes: 30,
    };
  }

  return {
    category: "ESPERAR",
    reason: `El fallo es aislado y el sistema conserva recuperación automática.${insufficientHistory}`,
    action: "Espera el siguiente intento automático.",
    reviewAt: "Revisa en 30 minutos.",
    suggestedPauseMinutes: 30,
  };
}

function commandsBlock(
  verdict: OperationalVerdict,
  adminCommandsAreEnabled: boolean,
): string[] {
  if (!adminCommandsAreEnabled) {
    return [
      "🎮 COMANDOS",
      "🔒 Los comandos de escritura están deshabilitados porque TELEGRAM_ADMIN_CHAT_IDS está vacío.",
      "📊 /estado — consultar la situación actual.",
    ];
  }

  const minutes = verdict.suggestedPauseMinutes ?? 30;
  if (verdict.category === "PAUSAR") {
    return [
      "🎮 COMANDOS",
      `⏸ /pausa ${minutes} — detiene todo ${minutes === 60 ? "una hora" : `${minutes} minutos`}`,
      `⏸ /pausa watchdog ${minutes} — detiene solo el watchdog`,
      "▶️ /reanudar — reactiva cuando el portal se estabilice",
      "ℹ️ Al reanudar se limpian los contadores de fallo. Espera a que pase la hora pico antes de reactivar.",
    ];
  }
  if (verdict.category === "INTERVENIR") {
    return [
      "🎮 COMANDOS",
      "⏸ /pausa — detén el radar mientras resuelves",
      "📊 /estado — verifica el estado tras la corrección",
      "▶️ /reanudar — reactiva cuando esté resuelto",
      "ℹ️ Reanudar limpia los contadores; hazlo solo después de corregir la causa.",
    ];
  }
  return [
    "🎮 COMANDOS",
    "📊 /estado — consulta la situación actual y los minutos restantes",
    `⏸ /pausa ${minutes} — deténlo manualmente si prefieres no esperar`,
    "▶️ /reanudar — reactiva en cualquier momento",
    "ℹ️ Reanudar limpia los contadores y permite intentos de red inmediatamente.",
  ];
}

export function formatVerdictBlock(
  verdict: OperationalVerdict,
  adminCommandsAreEnabled: boolean,
): string {
  const displayedAction = !adminCommandsAreEnabled &&
      verdict.category === "PAUSAR"
    ? `Detén el radar desde Railway durante ${verdict.suggestedPauseMinutes ?? 30} minutos.`
    : verdict.action;
  return [
    "━━━━━━━━━━━━━━━",
    `🎯 VEREDICTO: ${verdict.category}`,
    `💬 ${verdict.reason}`,
    `👉 ${displayedAction}`,
    `⏰ ${verdict.reviewAt}`,
    "",
    ...commandsBlock(verdict, adminCommandsAreEnabled),
  ].join("\n");
}

export function appendVerdict(
  baseMessage: string,
  verdict: OperationalVerdict,
  adminCommandsAreEnabled: boolean,
): string {
  return `${baseMessage}\n\n${formatVerdictBlock(verdict, adminCommandsAreEnabled)}`;
}

export function formatPausedInformation(input: {
  scope: string;
  resumeAt: string | null;
  adminCommandsAreEnabled: boolean;
  reason?: string;
}): string {
  const expiry = input.resumeAt
    ? new Intl.DateTimeFormat("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Mexico_City",
      }).format(new Date(input.resumeAt))
    : "manualmente";
  const commands = input.adminCommandsAreEnabled
    ? [
        "🎮 COMANDOS",
        "▶️ /reanudar — reactiva ahora",
        "📊 /estado — consulta los minutos restantes",
        input.resumeAt
          ? `ℹ️ La pausa expira sola a las ${expiry}. Reanudar antes habilita intentos de red inmediatamente.`
          : "ℹ️ La pausa es indefinida. Reanudar habilita intentos de red inmediatamente.",
      ]
    : [
        "🎮 COMANDOS",
        "🔒 Los comandos de escritura están deshabilitados porque TELEGRAM_ADMIN_CHAT_IDS está vacío.",
        "📊 /estado — consulta el estado de la pausa.",
      ];
  return [
    `⏸ Radar pausado manualmente: ${input.scope}.`,
    input.resumeAt ? `Hasta: ${expiry}.` : "Hasta: indefinidamente.",
    ...(input.reason ? [`Motivo: ${input.reason}.`] : []),
    "",
    ...commands,
  ].join("\n");
}
