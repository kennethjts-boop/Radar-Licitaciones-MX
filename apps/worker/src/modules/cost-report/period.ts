import { addDays, format, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { MX_TIMEZONE } from "../../core/time";

export interface MexicoDayBounds {
  date: string;
  startUtc: Date;
  endUtc: Date;
}

/** Fecha calendario en America/Mexico_City para un instante dado. */
export function mexicoDateOf(instant: Date): string {
  return formatInTimeZone(instant, MX_TIMEZONE, "yyyy-MM-dd");
}

export function shiftDate(date: string, days: number): string {
  return format(addDays(parseISO(`${date}T12:00:00`), days), "yyyy-MM-dd");
}

/** Día reportado: el día calendario MX anterior al instante dado. */
export function reportDateFor(now: Date): string {
  return shiftDate(mexicoDateOf(now), -1);
}

/** [00:00, 24:00) del día MX expresado en UTC; intervalo semiabierto. */
export function mexicoDayBounds(date: string): MexicoDayBounds {
  return {
    date,
    startUtc: fromZonedTime(`${date}T00:00:00`, MX_TIMEZONE),
    endUtc: fromZonedTime(`${shiftDate(date, 1)}T00:00:00`, MX_TIMEZONE),
  };
}

/** Hora y minuto locales MX (0-23, 0-59). */
export function mexicoClock(instant: Date): { hour: number; minute: number } {
  const [h, m] = formatInTimeZone(instant, MX_TIMEZONE, "H:m").split(":");
  return { hour: Number(h), minute: Number(m) };
}

/** Los N días MX previos a `date`, del más reciente al más antiguo. */
export function previousDates(date: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDate(date, -(i + 1)));
}
