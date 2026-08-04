import type TelegramBot from "node-telegram-bot-api";
import { createModuleLogger } from "../../core/logger";
import { formatMexicoDate } from "../../core/time";
import { getState, STATE_KEYS } from "../../core/system-state";
import { getLastChangedSnapshot, getLatestSnapshot } from "./repository";
import { getResolvedTargets, addDynamicTarget, removeDynamicTarget } from "./target-manager";
import type { WatchdogTelemetry } from "./types";
import { getEffectiveRadarMode } from "../control/sleep-mode";

const log = createModuleLogger("licitacion-watchdog:telegram");

function escapeHtml(value: unknown): string {
  return String(value ?? "N/D").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function handleEstadoCommand(bot: TelegramBot, chatId: string): Promise<void> {
  try {
    const mode = await getEffectiveRadarMode();
    const modeHeader =
      mode === "watchdog_only"
        ? "MODO: 😴 DORMIDO (solo watchdog)"
        : "MODO: ☀️ COMPLETO";

    const targets = await getResolvedTargets();
    const telemetry = await getState<WatchdogTelemetry>(STATE_KEYS.WATCHDOG_TELEMETRY);
    const lastChecked = telemetry?.lastCheckedAt
      ? formatMexicoDate(telemetry.lastCheckedAt, "dd/MM/yyyy HH:mm")
      : "Sin registro";

    const lines = [
      modeHeader,
      "",
      `🐕 <b>Watchdog Multi-Target (${targets.length} licitaciones)</b>`,
      `⏰ Última revisión: <b>${escapeHtml(lastChecked)} CDMX</b>`,
      "",
    ];

    for (const t of targets) {
      const [latest, lastChange] = await Promise.all([
        getLatestSnapshot(t.numero),
        getLastChangedSnapshot(t.numero),
      ]);

      const statusField =
        (latest?.snapshot_json?.visibleFields as any)?.[
          "Estatus del procedimiento de contratación"
        ] ||
        (latest?.snapshot_json?.detail as any)?.registro?.[0]?.estatus ||
        "Desconocido / Sin snapshot";

      const lastChangeDisplay = lastChange
        ? formatMexicoDate(lastChange.created_at, "dd/MM/yyyy HH:mm")
        : "Sin cambios registrados";

      lines.push(
        `• <b>${escapeHtml(t.alias)}</b> (<code>${escapeHtml(t.numero)}</code>)`,
        `  Estatus actual: <b>${escapeHtml(statusField)}</b>`,
        `  Último cambio: <b>${escapeHtml(lastChangeDisplay)}</b>`,
        "",
      );
    }

    await bot.sendMessage(chatId, lines.join("\n").trim(), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }).catch(() => {});
  } catch (err) {
    log.error({ err }, "Error en /estado");
    await bot.sendMessage(chatId, "⚠️ Error consultando el estado del radar.").catch(() => {});
  }
}

export async function handleWatchdogCommand(bot: TelegramBot, chatId: string): Promise<void> {
  try {
    const targets = await getResolvedTargets();
    const telemetry = await getState<WatchdogTelemetry>(STATE_KEYS.WATCHDOG_TELEMETRY);
    const lines = [
      "🐕 <b>Estado del Watchdog Multi-Target</b>",
      `Estado global: <b>${escapeHtml(telemetry?.status ?? "sin ejecución")}</b>`,
      `Última verificación: <b>${escapeHtml(formatMexicoDate(telemetry?.lastCheckedAt, "dd/MM/yyyy HH:mm"))} CDMX</b>`,
      "",
    ];
    for (const target of targets) {
      const [latest, lastChange] = await Promise.all([
        getLatestSnapshot(target.numero),
        getLastChangedSnapshot(target.numero),
      ]);
      const statusField = (latest?.snapshot_json?.visibleFields as any)?.[
        "Estatus del procedimiento de contratación"
      ] || (latest?.snapshot_json?.detail as any)?.registro?.[0]?.estatus || "desconocido";

      lines.push(
        `• <b>${escapeHtml(target.alias)}</b> (<code>${escapeHtml(target.numero)}</code>)`,
        `  Estatus actual: <b>${escapeHtml(statusField)}</b>`,
        `  Último snapshot: <b>${escapeHtml(latest ? formatMexicoDate(latest.created_at, "dd/MM/yyyy HH:mm") : "sin baseline")}</b>`,
        `  Último cambio: <b>${escapeHtml(lastChange ? formatMexicoDate(lastChange.created_at, "dd/MM/yyyy HH:mm") : "ninguno")}</b>`,
      );
    }
    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "HTML", disable_web_page_preview: true }).catch(() => {});
  } catch (err) {
    log.error({ err, suppressTelegram: true }, "Error contenido en /watchdog");
    await bot.sendMessage(chatId, "⚠️ No pude consultar el estado del watchdog; revisar logs.").catch(() => {});
  }
}

export async function handleRadaresCommand(bot: TelegramBot, chatId: string): Promise<void> {
  try {
    const targets = await getResolvedTargets();
    const telemetry = await getState<WatchdogTelemetry>(STATE_KEYS.WATCHDOG_TELEMETRY);
    const lastChecked = formatMexicoDate(telemetry?.lastCheckedAt, "dd/MM/yyyy HH:mm");

    const lines = [
      `📡 <b>Radares Watchdog Activos (${targets.length})</b>`,
      `⏰ Última revisión: <b>${escapeHtml(lastChecked)} CDMX</b>`,
      "",
    ];

    for (const t of targets) {
      const [latest, lastChange] = await Promise.all([
        getLatestSnapshot(t.numero),
        getLastChangedSnapshot(t.numero),
      ]);

      const statusField = (latest?.snapshot_json?.visibleFields as any)?.[
        "Estatus del procedimiento de contratación"
      ] || (latest?.snapshot_json?.detail as any)?.registro?.[0]?.estatus || "Desconocido / Sin snapshot";

      const lastChangeDisplay = lastChange
        ? formatMexicoDate(lastChange.created_at, "dd/MM/yyyy HH:mm")
        : "Sin cambios registrados";

      lines.push(
        `• <b>${escapeHtml(t.alias)}</b>`,
        `  Procedimiento: <code>${escapeHtml(t.numero)}</code>`,
        `  Estatus actual: <b>${escapeHtml(statusField)}</b>`,
        `  Último cambio: <b>${escapeHtml(lastChangeDisplay)}</b>`,
        `  🔗 <a href="${escapeHtml(t.expedienteUrl)}">Expediente ComprasMX</a>`,
        "",
      );
    }

    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "HTML", disable_web_page_preview: true }).catch(() => {});
  } catch (err) {
    log.error({ err }, "Error en /radares");
    await bot.sendMessage(chatId, "⚠️ Error consultando los radares del watchdog.").catch(() => {});
  }
}

export async function handleVigilarCommand(bot: TelegramBot, chatId: string, numeroInput: string): Promise<void> {
  const numero = numeroInput.trim();
  if (!numero) {
    await bot.sendMessage(chatId, "⚠️ Uso: <code>/vigilar &lt;numero_procedimiento&gt;</code>", { parse_mode: "HTML" }).catch(() => {});
    return;
  }

  await bot.sendMessage(chatId, `🔍 Buscando y resolviendo expediente <code>${escapeHtml(numero)}</code>...`, { parse_mode: "HTML" }).catch(() => {});

  try {
    const target = await addDynamicTarget(numero);
    const lines = [
      `✅ <b>Expediente agregado al watchdog</b>`,
      `Alias: <b>${escapeHtml(target.alias)}</b>`,
      `Número: <code>${escapeHtml(target.numero)}</code>`,
      `UUID resuelto: <code>${escapeHtml(target.uuid)}</code>`,
      `🔗 <a href="${escapeHtml(target.expedienteUrl)}">Ver en ComprasMX</a>`,
      "",
      "<i>Se vigilará automáticamente en cada ciclo del watchdog.</i>",
    ];
    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "HTML", disable_web_page_preview: true }).catch(() => {});
  } catch (err: any) {
    log.error({ err, numero }, "Error en /vigilar");
    await bot.sendMessage(chatId, `❌ No se pudo dar de alta el expediente: ${escapeHtml(err?.message || "Error desconocido")}`, { parse_mode: "HTML" }).catch(() => {});
  }
}

export async function handleNoVigilarCommand(bot: TelegramBot, chatId: string, idInput: string): Promise<void> {
  const query = idInput.trim();
  if (!query) {
    await bot.sendMessage(chatId, "⚠️ Uso: <code>/novigilar &lt;id_o_numero&gt;</code>", { parse_mode: "HTML" }).catch(() => {});
    return;
  }

  try {
    const removed = await removeDynamicTarget(query);
    if (removed) {
      await bot.sendMessage(chatId, `🗑 <b>Expediente <code>${escapeHtml(query)}</code> removido del monitoreo dinámico.</b>`, { parse_mode: "HTML" }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, `⚠️ No se encontró un expediente dinámico registrado con ID o número: <code>${escapeHtml(query)}</code>`, { parse_mode: "HTML" }).catch(() => {});
    }
  } catch (err: any) {
    log.error({ err, query }, "Error en /novigilar");
    await bot.sendMessage(chatId, `❌ Error removiendo expediente: ${escapeHtml(err?.message || "Error desconocido")}`, { parse_mode: "HTML" }).catch(() => {});
  }
}
