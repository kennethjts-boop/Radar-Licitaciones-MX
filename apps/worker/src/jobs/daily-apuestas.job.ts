import { createModuleLogger } from "../core/logger";
import { todayMexicoStr } from "../core/time";
import { sendTelegramMessage } from "../alerts/telegram.alerts";
import { runApuestasRadar } from "../radars/apuestas.radar";

const log = createModuleLogger("daily-apuestas-job");

export const DAILY_APUESTAS_CRON = "0 8 * * *";

export async function runDailyApuestasJob(): Promise<void> {
  try {
    const fecha = todayMexicoStr();
    const items = await runApuestasRadar();

    const lines: string[] = [`🎯 RADAR APUESTAS — ${fecha}`, ""];

    for (const item of items) {
      const isSoccer = item.deporte.startsWith("soccer_");
      lines.push(`${isSoccer ? "⚽" : "⚾"} ${item.equipoLocal} vs ${item.equipoVisitante} | ${item.liga}`);
      lines.push(`🏆 Predicción ganador: ${item.prediccionGanador} (${item.probabilidadModeladaPct.toFixed(1)}%)`);
      lines.push(`📊 1X2/Moneyline: ${item.resultado1X2}`);
      if (isSoccer) {
        lines.push(`📊 BTTS: ${item.bttsPick} (${item.bttsProbPct === null ? "N/D" : `${item.bttsProbPct.toFixed(1)}%`})`);
        lines.push(`📊 Total goles: ${item.totalPick} (${item.totalProbPct === null ? "N/D" : `${item.totalProbPct.toFixed(1)}%`})`);
      } else {
        lines.push(`📊 Total carreras: ${item.totalPick} (${item.totalProbPct === null ? "N/D" : `${item.totalProbPct.toFixed(1)}%`})`);
      }
      lines.push(`💡 Value bet: ${item.valueBet ? "Sí" : "No"} | Edge ${(item.probabilidadModeladaPct - item.probabilidadImplicitaPct).toFixed(1)} pts`);
      lines.push(`📈 Top 3 casas: ${item.topCasas.slice(0, 3).map((b) => `${b.casa} ${b.cuota.toFixed(2)}`).join(" | ")}`);
      lines.push(`⚠️ Confianza: ${item.confianza} | Liquidez: ${item.liquidez} | Score: ${item.score}`);
      lines.push(`🔗 Mercado recomendado: ${item.mercadoRecomendado} @ ${item.cuotaRecomendada.toFixed(2)} (${item.casaRecomendada})`);
      if (item.arbitrajeGarantizado) {
        lines.push(`💰 ARBITRAJE GARANTIZADO: +${item.gananciaGarantizadaPct.toFixed(2)}%`);
        lines.push(`💵 Stake A/B: $${item.stakeSugeridoA.toFixed(2)} / $${item.stakeSugeridoB.toFixed(2)} MXN`);
      }
      lines.push("─────────────────");
      lines.push("");
    }

    lines.push(`✅ ${items.length} oportunidades analizadas (predictivo + arbitraje)`);
    await sendTelegramMessage(lines.join("\n"), "HTML");
  } catch (err) {
    log.error({ err }, "Error en daily apuestas job");
  }
}
