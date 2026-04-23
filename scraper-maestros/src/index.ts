import dotenv from "dotenv";
import fs from "fs";
import { scrapearPNT } from "./scrapers/pnt";
import { generarExcel } from "./utils/excel";
import { generarPDF } from "./utils/pdf";
import { enviarTelegram } from "./utils/telegram";
import { Maestro } from "./types";

dotenv.config();

function deduplicar(maestros: Maestro[]): Maestro[] {
  const map = new Map<string, Maestro>();
  for (const m of maestros) {
    const key = `${m.nombre.trim().toLowerCase()}-${m.cct.trim().toLowerCase()}`;
    if (map.has(key)) {
      const existing = map.get(key)!;
      existing.fuentes_consultadas = Array.from(new Set([...existing.fuentes_consultadas, ...m.fuentes_consultadas]));
      if (!existing.email_institucional && m.email_institucional) existing.email_institucional = m.email_institucional;
      if (!existing.zona_escolar && m.zona_escolar) existing.zona_escolar = m.zona_escolar;
      if (!existing.supervisor_zona && m.supervisor_zona) existing.supervisor_zona = m.supervisor_zona;
      if (!existing.funcion && m.funcion) existing.funcion = m.funcion;
      if (!existing.horas_asignadas && m.horas_asignadas) existing.horas_asignadas = m.horas_asignadas;
      if (!existing.antiguedad && m.antiguedad) existing.antiguedad = m.antiguedad;
    } else {
      map.set(key, m);
    }
  }
  return Array.from(map.values());
}

async function main() {
  console.log("Iniciando scraper maestros Morelos (Modo PNT Híbrido)...");
  fs.mkdirSync("output", { recursive: true });
  
  let maestros: Maestro[] = [];
  
  // Fuente Única: PNT (Plataforma Nacional de Transparencia)
  const docentesPNT = await scrapearPNT();
  maestros = [...maestros, ...docentesPNT];
  
  // SI FALLAN TODAS LAS FUENTES ONLINE: No inyectamos fallback. Fallamos ruidosamente o enviamos lo que tengamos.
  if (maestros.length === 0) {
    console.log("No se pudo obtener información de ninguna fuente.");
  }
  
  // Deduplicar
  maestros = deduplicar(maestros);
  console.log(`Total maestros encontrados: ${maestros.length}`);
  
  // Generar archivos
  if (maestros.length > 0) {
    await generarExcel(maestros);
    await generarPDF(maestros);
  }
  
  // Enviar Telegram
  await enviarTelegram(maestros);
  
  process.exit(0);
}

main().catch(err => {
  console.error("Error no manejado:", err.message);
  process.exit(0);
});
