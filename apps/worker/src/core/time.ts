/**
 * TIME — Manejo de fechas en zona horaria de México.
 * Toda la lógica de scheduling debe pasar por aquí.
 */
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { format, parseISO, isValid } from "date-fns";

const MX_TIMEZONE = "America/Mexico_City";

/**
 * Retorna la fecha/hora actual en México como Date objeto.
 */
export function nowInMexico(): Date {
  return toZonedTime(new Date(), MX_TIMEZONE);
}

/**
 * Retorna el timestamp ISO-8601 actual en UTC.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Formatea una fecha en la zona horaria de México.
 */
export function formatMexicoDate(
  date: Date | string,
  fmt = "dd/MM/yyyy HH:mm",
): string {
  // Si es string solo-fecha (YYYY-MM-DD), interpretar como fecha local sin
  // conversión de timezone para evitar desfase de un día (parseISO la trataría
  // como medianoche UTC → día anterior en México UTC-6).
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const d = parseISO(date + "T12:00:00");
    if (!isValid(d)) return "Fecha inválida";
    return formatInTimeZone(d, MX_TIMEZONE, fmt);
  }
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "Fecha inválida";
  return formatInTimeZone(d, MX_TIMEZONE, fmt);
}

/**
 * Retorna YYYY-MM-DD en México.
 */
export function todayMexicoStr(): string {
  return formatInTimeZone(new Date(), MX_TIMEZONE, "yyyy-MM-dd");
}

/**
 * Parsea una fecha ISO o string de fecha a Date, retorna null si inválida.
 */
export function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const d = parseISO(dateStr);
  return isValid(d) ? d : null;
}

/**
 * Retorna la hora actual en México (0-23).
 */
export function currentHourInMexico(): number {
  const now = nowInMexico();
  return now.getHours();
}

/**
 * Convierte diferencia en ms a string legible "Xh Ym Zs".
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

/**
 * Retorna true si la fecha de apertura ya pasó (licitación vencida).
 * openingDate puede ser ISO-8601 o null.
 */
export function isDateExpired(openingDate: string | null | undefined): boolean {
  if (!openingDate) return false;
  const d = parseDate(openingDate);
  if (!d) return false;
  return d < new Date();
}

/**
 * Retorna true si han pasado al menos N minutos desde el timestamp dado.
 */
export function hasElapsedMinutes(
  since: Date | string,
  minutes: number,
): boolean {
  const sinceDate = typeof since === "string" ? parseISO(since) : since;
  const elapsed = Date.now() - sinceDate.getTime();
  return elapsed >= minutes * 60 * 1000;
}
