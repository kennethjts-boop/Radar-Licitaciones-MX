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

function formatCloseWindow(hoursToClose: number | null, closeAt: string | null): string {
  if (hoursToClose === null) return `Cierre: ${withFallback(closeAt)}`;
  return `Cierra en ${Math.ceil(hoursToClose)} horas (${withFallback(closeAt)})`;
}

export async function runDailySubastasJob(): Promise<void> {
  log.info("Iniciando daily subastas job");

  try {
    const result = await runSubastasRadar();
    const fecha = todayMexicoStr();

    if (result.top10.length === 0) {
      await sendTelegramMessage(`🏗️ SUBASTAS DEL DÍA — ${fecha}\n\nSin oportunidades detectadas hoy.`, "HTML");
      return;
    }

    for (const item of result.top10) {
      const lines: string[] = [];
      lines.push(`🏗️ SUBASTA TOP — ${fecha}`);
      lines.push(`🏷️ ${item.title}`);
      lines.push(
        `💰 Base ${formatPrice(item.currentPrice)} vs mercado ${formatPrice(item.marketEstimateResolved)} | Descuento ${item.discountPct === null ? "N/D" : `${item.discountPct.toFixed(1)}%`}`,
      );
      lines.push(`📊 Pujas actuales: ${item.activeBids === null ? "N/D" : item.activeBids}`);
      lines.push(`⏰ ${formatCloseWindow(item.hoursToClose, item.closeAt)}`);
      lines.push(`📍 Ubicación: ${withFallback(item.location)}`);
      lines.push(`🚚 Logística: ${item.logisticsSummary}`);
      lines.push(`📋 Requisitos: ${item.requirementsSummary}`);
      lines.push(`📞 Contacto: ${withFallback(item.auctionHouseAddress)}`);
      lines.push(`☎️ Tel: ${withFallback(item.contactPhone)} | ✉️ ${withFallback(item.contactEmail)}`);
      lines.push(`🔗 ${item.url}`);
      lines.push(`🌐 Fuente: ${item.sourceLabel}`);
      lines.push(`⭐ ${item.scoreExplanation}`);

      await sendTelegramMessage(lines.join("\n"), "HTML");
    }

    const top = result.top10[0];
    await sendTelegramMessage(
      [
        `📌 RESUMEN SUBASTAS — ${fecha}`,
        `✅ Total encontradas: ${result.scannedTotal}`,
        `🥇 Top oportunidad: ${top.title}`,
        `⭐ ${top.scoreExplanation}`,
        `🔗 ${top.url}`,
      ].join("\n"),
      "HTML",
    );

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
