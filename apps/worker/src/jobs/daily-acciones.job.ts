import { createModuleLogger } from "../core/logger";
import { todayMexicoStr } from "../core/time";
import { sendTelegramMessage } from "../alerts/telegram.alerts";
import { runAccionesRadar } from "../radars/acciones.radar";

const log = createModuleLogger("daily-acciones-job");

export const DAILY_ACCIONES_CRON = "0 9 * * 1-5";

function asNum(value: number | null): string {
  if (value === null) return "N/D";
  return value.toFixed(2);
}

export async function runDailyAccionesJob(): Promise<void> {
  try {
    const fecha = todayMexicoStr();
    const items = await runAccionesRadar();

    const lines: string[] = [`📈 RADAR ACCIONES — ${fecha}`, ""];

    for (const item of items) {
      lines.push(`📌 ${item.ticker} (${item.nombre})`);
      lines.push(
        `💰 ${item.precioActual.toFixed(2)} | Señal: ${item.senal.toUpperCase()} | Score: ${item.score}`,
      );
      lines.push(
        `📊 RSI: ${asNum(item.rsi)} | MACD: ${asNum(item.macd)} | Vol. anómalo: ${item.volumenAnomalo ? "Sí" : "No"}`,
      );
      lines.push(`🏷️ Sector: ${item.sector} | Mercado: ${item.mercado}`);
      lines.push("─────────────────");
      lines.push("");
    }

    lines.push(`✅ ${items.length} oportunidades seleccionadas (Top 5)`);
    await sendTelegramMessage(lines.join("\n"), "HTML");
  } catch (err) {
    log.error({ err }, "Error en daily acciones job");
  }
}
