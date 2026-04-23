import fs from "fs";
import { Maestro } from "../types";

export async function enviarTelegram(maestros: Maestro[]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!token || !chatId) {
    console.log("[Telegram] Credenciales no configuradas.");
    return;
  }

  if (maestros.length === 0) {
    const text = `⚠️ Scraping completado sin datos
Fuentes intentadas: datos.gob.mx, SEP, IEBEM, Transparencia Morelos, SAIMEX
Ninguna devolvió resultados.`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    return;
  }

  const escuelasTotales = new Set(maestros.map(m => m.cct)).size;
  const municipiosTotales = new Set(maestros.map(m => m.municipio)).size;

  const text = `✅ Scraping maestros completado
👨‍🏫 Maestros encontrados: ${maestros.length}
🏫 Escuelas: ${escuelasTotales}
📍 Municipios: ${municipiosTotales}
⚠️ Fuentes fallidas: ninguna
📎 Archivos adjuntos a continuación...`;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });

  const sendDoc = async (filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        const fileStream = fs.readFileSync(filePath);
        const fileName = filePath.split('/').pop() || 'document.file';
        const formData = new FormData();
        formData.append("chat_id", chatId);
        formData.append("document", new Blob([fileStream]), fileName);

        await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
          method: "POST",
          body: formData
        });
      }
    } catch (e) {
      console.warn(`[Telegram] Error sending doc ${filePath}: ${(e as Error).message}`);
    }
  };

  await sendDoc("output/maestros-morelos.xlsx");
  await sendDoc("output/maestros-morelos.pdf");
}
