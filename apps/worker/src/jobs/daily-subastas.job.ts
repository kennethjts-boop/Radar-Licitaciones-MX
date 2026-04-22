import { createModuleLogger } from "../core/logger";
import { todayMexicoStr } from "../core/time";
import { sendTelegramMessage } from "../alerts/telegram.alerts";
import { runSubastasRadar } from "../radars/subastas.radar";

const log = createModuleLogger("daily-subastas-job");

export const DAILY_SUBASTAS_CRON = "0 8 * * *";

function formatPrice(value: number | null): string {
  if (value === null) return "Ver en sitio";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function withFallback(value: string | null | undefined): string {
  if (!value) return "Ver en sitio";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Ver en sitio";
}

export async function runDailySubastasJob(): Promise<void> {
  log.info("Iniciando daily subastas job");

  try {
    const result = await runSubastasRadar();
    const fecha = todayMexicoStr();

    const lines: string[] = [`🏗️ SUBASTAS DEL DÍA — ${fecha}`, ""];

    for (const item of result.top10) {
      lines.push(`${item.countryEmoji} [${item.sourceLabel}] ${item.title}`);
      lines.push(
        `💰 ${formatPrice(item.currentPrice)} | 🗓️ Cierre: ${withFallback(item.closeAt)}`,
      );
      lines.push(`📍 ${withFallback(item.location)}`);
      lines.push(
        `📞 ${withFallback(item.contactPhone)} | ✉️ ${withFallback(item.contactEmail)}`,
      );
      lines.push(`🔗 ${item.url}`);
      lines.push("─────────────────");
      lines.push("");
    }

    lines.push(
      `✅ ${result.scannedTotal} oportunidades escaneadas | Top 10 seleccionadas`,
    );

    await sendTelegramMessage(lines.join("\n"), "HTML");

    log.info(
      {
        scanned: result.scannedTotal,
        top: result.top10.length,
      },
      "Daily subastas enviado a Telegram",
    );
  } catch (err) {
    log.error({ err }, "Error en daily subastas job");
  }
}
