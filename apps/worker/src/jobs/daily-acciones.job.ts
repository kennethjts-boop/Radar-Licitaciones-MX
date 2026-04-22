import { createModuleLogger } from "../core/logger";
import { todayMexicoStr } from "../core/time";
import { sendTelegramMessage } from "../alerts/telegram.alerts";
import { runAccionesRadar } from "../radars/acciones.radar";

const log = createModuleLogger("daily-acciones-job");

export const DAILY_ACCIONES_CRON = "0 9 * * 1-5";

function asNum(value: number | null, digits = 2): string {
  if (value === null) return "N/D";
  return value.toFixed(digits);
}

export async function runDailyAccionesJob(): Promise<void> {
  try {
    const fecha = todayMexicoStr();
    const items = await runAccionesRadar();

    const corto = items.filter((i) => i.horizonte === "corto").slice(0, 3);
    const mediano = items.filter((i) => i.horizonte === "mediano").slice(0, 3);
    const largo = items.filter((i) => i.horizonte === "largo").slice(0, 3);

    const lines: string[] = [`📈 RADAR ACCIONES — ${fecha}`, ""];

    const renderSection = (title: string, sectionItems: typeof items) => {
      lines.push(title);
      if (sectionItems.length === 0) {
        lines.push("Sin señales suficientes hoy.");
        lines.push("");
        return;
      }

      for (const item of sectionItems) {
        lines.push(`📊 ${item.ticker} | ${item.nombre} | ${item.sector} (${item.mercado})`);
        lines.push(`💲 ${item.precioActual.toFixed(2)} | Día ${item.cambioDiaPct.toFixed(2)}% | Score ${item.score}`);
        lines.push(`🎯 Objetivo ${item.targetPrice === null ? "N/D" : item.targetPrice.toFixed(2)} | Upside ${item.upsidePct === null ? "N/D" : `${item.upsidePct.toFixed(1)}%`}`);
        lines.push(`🔍 ${item.razon}`);
        lines.push(`⚠️ Riesgo ${item.riesgo}: ${item.riesgoRazon}`);
        lines.push(`💡 ${item.accionSugerida}`);
        lines.push(
          `🌟 Desglose score — Técnico ${item.scoreDesglose.tecnico} | Tendencia ${item.scoreDesglose.tendencia} | Fundamental ${item.scoreDesglose.fundamental} | Riesgo ${item.scoreDesglose.riesgo}`,
        );
        if (item.noticias.length > 0) {
          lines.push(`📰 Noticias: ${item.noticias.join(" | ")}`);
        }
        lines.push("─────────────────");
      }
      lines.push("");
    };

    renderSection("🚀 CORTO PLAZO — Top 3", corto);
    renderSection("📅 MEDIANO PLAZO — Top 3", mediano);
    renderSection("🌱 LARGO PLAZO — Top 3", largo);

    await sendTelegramMessage(lines.join("\n"), "HTML");
  } catch (err) {
    log.error({ err }, "Error en daily acciones job");
  }
}
