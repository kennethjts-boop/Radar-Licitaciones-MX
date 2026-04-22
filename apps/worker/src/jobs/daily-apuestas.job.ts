import { createModuleLogger } from "../core/logger";
import { todayMexicoStr } from "../core/time";
import { sendTelegramMessage } from "../alerts/telegram.alerts";
import { runApuestasRadar } from "../radars/apuestas.radar";

const log = createModuleLogger("daily-apuestas-job");

export const DAILY_APUESTAS_CRON = "0 9,15 * * *";

export async function runDailyApuestasJob(): Promise<void> {
  try {
    const fecha = todayMexicoStr();
    const items = await runApuestasRadar();

    const lines: string[] = [`⚽ RADAR APUESTAS — ${fecha}`, ""];

    for (const item of items) {
      lines.push(`🏟️ ${item.liga} | ${item.equipoLocal} vs ${item.equipoVisitante}`);
      lines.push(`📈 Arbitraje ${item.gananciaGarantizadaPct.toFixed(2)}% | Score: ${item.score}`);
      lines.push(`🏦 A: ${item.casaA} (${item.cuotaA}) | B: ${item.casaB} (${item.cuotaB})`);
      lines.push(
        `💵 Stake A: $${item.stakeSugeridoA.toFixed(2)} MXN | Stake B: $${item.stakeSugeridoB.toFixed(2)} MXN`,
      );
      lines.push(`⏱️ Cierre: ${item.cierreAt}`);
      lines.push("─────────────────");
      lines.push("");
    }

    lines.push(`✅ ${items.length} oportunidades de arbitraje`);
    await sendTelegramMessage(lines.join("\n"), "HTML");
  } catch (err) {
    log.error({ err }, "Error en daily apuestas job");
  }
}
