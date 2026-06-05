/**
 * ERROR NOTIFIER — Intercepta entradas pino ERROR/FATAL y las envía a Telegram.
 *
 * Diseño deferred: el notificador se registra DESPUÉS de que Telegram esté
 * disponible (post-bootstrap), por lo que logger.ts no depende de telegram.alerts.
 *
 * Protecciones:
 *  - Ignora errores del propio módulo telegram-alerts para evitar bucles infinitos.
 *  - Deduplica mensajes idénticos dentro de una ventana de 2 minutos.
 */

type SendFn = (text: string) => void;

let _send: SendFn | null = null;

/** Mapa de dedup: clave → timestamp del último envío */
const _recentlySent = new Map<string, number>();
const DEDUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutos

/** Registrar la función que envía el texto a Telegram. */
export function registerErrorNotifier(fn: SendFn): void {
  _send = fn;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface PinoEntry {
  level: number;
  module?: string;
  msg: string;
  err?: { message?: string; stack?: string; code?: string };
  reason?: { message?: string; stack?: string };
  time?: string;
  [key: string]: unknown;
}

/**
 * Procesa una línea JSON de pino.
 * Si el nivel es ERROR (50) o FATAL (60), formatea y envía a Telegram.
 * Llamado desde el TelegramErrorStream en logger.ts.
 */
export function handlePinoEntry(line: string): void {
  if (!_send) return;

  let entry: PinoEntry;
  try {
    entry = JSON.parse(line) as PinoEntry;
  } catch {
    return; // línea no-JSON (ej. pino-pretty en dev)
  }

  if (entry.level < 50) return; // info/debug/trace → ignorar

  const module = entry.module ?? "worker";

  // Evitar bucle infinito: no notificar errores del propio módulo Telegram
  if (module === "telegram-alerts") return;

  const isFatal = entry.level >= 60;
  const emoji = isFatal ? "💥" : "🔴";
  const levelLabel = isFatal ? "FATAL" : "ERROR";

  const errMessage =
    entry.err?.message ??
    entry.reason?.message ??
    "";
  const errCode = entry.err?.code ?? "";
  const rawStack =
    entry.err?.stack ??
    entry.reason?.stack ??
    "";

  // Primeras 4 líneas del stack (sin repetir el mensaje)
  const stackExcerpt = rawStack
    .split("\n")
    .filter(Boolean)
    .slice(0, 4)
    .map((l) => l.trim())
    .join("\n");

  // Dedup: misma combinación módulo+msg+error → no enviar durante 2 min
  const dedupKey = `${module}|${entry.msg}|${errMessage}`;
  const lastSent = _recentlySent.get(dedupKey) ?? 0;
  if (Date.now() - lastSent < DEDUP_WINDOW_MS) return;
  _recentlySent.set(dedupKey, Date.now());

  const parts: string[] = [
    `${emoji} <b>[${levelLabel}] ${escapeHtml(module)}</b>`,
    "",
    `📌 ${escapeHtml(entry.msg)}`,
  ];

  if (errMessage && errMessage !== entry.msg) {
    parts.push(`💬 <code>${escapeHtml(errMessage)}</code>`);
  }
  if (errCode) {
    parts.push(`🏷 Code: <code>${escapeHtml(errCode)}</code>`);
  }
  if (stackExcerpt) {
    parts.push("", `<pre>${escapeHtml(stackExcerpt)}</pre>`);
  }

  _send(parts.join("\n"));
}
