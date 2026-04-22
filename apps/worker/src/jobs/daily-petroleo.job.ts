import { createModuleLogger } from "../core/logger";
import { todayMexicoStr } from "../core/time";
import { sendTelegramMessage } from "../alerts/telegram.alerts";
import { runPetroleoRadar } from "../radars/petroleo.radar";

const log = createModuleLogger("daily-petroleo-job");

export const DAILY_PETROLEO_CRON = "0 10 * * 3";

export async function runDailyPetroleoJob(): Promise<void> {
  try {
    const fecha = todayMexicoStr();
    const items = await runPetroleoRadar();

    const lines: string[] = [`🛢️ RADAR PETRÓLEO — ${fecha}`, ""];

    for (const item of items) {
      lines.push(`📌 ${item.tipo} | Señal: ${item.senal.toUpperCase()} | Score: ${item.score}`);
      lines.push(`💰 ${item.precio.toFixed(2)} | Δ ${item.cambioPct.toFixed(2)}%`);
      lines.push(
        `🧭 Soporte: ${item.precioSoporte.toFixed(2)} | Resistencia: ${item.precioResistencia.toFixed(2)}`,
      );
      lines.push(
        `📦 Inventarios: ${item.inventariosCambioPct === null ? "N/D" : `${item.inventariosCambioPct.toFixed(2)}%`} | Evento: ${item.evento}`,
      );
      lines.push("─────────────────");
      lines.push("");
    }

    lines.push(`✅ ${items.length} señales detectadas`);
    await sendTelegramMessage(lines.join("\n"), "HTML");
  } catch (err) {
    log.error({ err }, "Error en daily petróleo job");
  }
}
