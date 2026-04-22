import { createModuleLogger } from "../core/logger";
import { todayMexicoStr } from "../core/time";
import { sendTelegramMessage } from "../alerts/telegram.alerts";
import { runPetroleoRadar } from "../radars/petroleo.radar";

const log = createModuleLogger("daily-petroleo-job");

export const DAILY_PETROLEO_CRON = "0 10 * * 1,3,5";

export async function runDailyPetroleoJob(): Promise<void> {
  try {
    const fecha = todayMexicoStr();
    const items = await runPetroleoRadar();

    if (items.length === 0) {
      await sendTelegramMessage(`🛢️ BRIEFING PETRÓLEO — ${fecha}\n\nSin datos suficientes para generar señal hoy.`, "HTML");
      return;
    }

    const wti = items.find((i) => i.tipo === "WTI");
    const brent = items.find((i) => i.tipo === "BRENT");
    const spread = wti && brent ? brent.precio - wti.precio : null;
    const principal = items[0];

    const lines: string[] = [`🛢️ BRIEFING EJECUTIVO ENERGÍA — ${fecha}`, ""];

    lines.push(
      `🛢️ WTI ${wti ? `$${wti.precio.toFixed(2)}` : "N/D"} | Brent ${brent ? `$${brent.precio.toFixed(2)}` : "N/D"} | Spread ${spread === null ? "N/D" : `$${spread.toFixed(2)}`}`,
    );

    for (const item of items) {
      lines.push(`📊 ${item.tipo}: Día ${item.cambioDiarioPct.toFixed(2)}% | Semana ${item.cambioSemanalPct.toFixed(2)}% | Mes ${item.cambioMensualPct.toFixed(2)}%`);
      lines.push(`📉 Técnico ${item.tipo}: Soporte $${item.precioSoporte.toFixed(2)} | Resistencia $${item.precioResistencia.toFixed(2)} | Tendencia ${item.tendencia}`);
    }

    lines.push(
      `🏭 Inventarios EIA: ${principal.inventariosCambioPct === null ? "N/D" : `${principal.inventariosCambioPct.toFixed(2)}%`} vs expectativa ${principal.inventariosEsperadoPct === null ? "N/D" : `${principal.inventariosEsperadoPct.toFixed(2)}%`}`,
    );
    lines.push(`🌍 Contexto geopolítico: ${principal.contextoGeopolitico}`);
    lines.push(`💡 Señal principal: ${principal.senal.toUpperCase()} — ${principal.justificacionSenal}`);
    lines.push("🎯 Cómo invertir (retail MX): ETFs USO, OIL, XLE, UCO (2x) | CFDs según broker regulado | Acciones XOM, CVX, OXY, PEMEX");
    lines.push(`📈 Objetivo 30 días (${principal.tipo}): $${principal.objetivo30dMin.toFixed(2)} - $${principal.objetivo30dMax.toFixed(2)}`);
    lines.push(`⚠️ Riesgos clave: ${principal.riesgos.join(" | ")}`);
    lines.push(
      `🔔 Próximos eventos: ${principal.proximosEventos.map((e) => `${e.nombre} (${e.fecha})`).join(" | ")}`,
    );

    await sendTelegramMessage(lines.join("\n"), "HTML");
  } catch (err) {
    log.error({ err }, "Error en daily petróleo job");
  }
}
