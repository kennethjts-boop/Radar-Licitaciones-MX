import puppeteer from "puppeteer";
import { Maestro } from "../types";

export async function generarPDF(maestros: Maestro[]): Promise<void> {
  const outputPath = "output/maestros-morelos.pdf";
  const escuelasTotales = new Set(maestros.map(m => m.cct)).size;
  const municipiosTotales = new Set(maestros.map(m => m.municipio)).size;
  const fecha = new Date().toLocaleDateString();

  const byMunicipio: Record<string, Maestro[]> = {};
  maestros.forEach(m => {
    const muni = m.municipio || "Desconocido";
    if (!byMunicipio[muni]) byMunicipio[muni] = [];
    byMunicipio[muni].push(m);
  });

  const municipiosSorted = Object.keys(byMunicipio).sort();

  let htmlCompleto = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 0; font-size: 12px; }
          .portada { text-align: center; margin-top: 200px; page-break-after: always; }
          h1 { font-size: 32px; color: #2c3e50; }
          .resumen { margin-top: 50px; font-size: 18px; }
          h2 { color: #2980b9; border-bottom: 2px solid #2980b9; padding-bottom: 5px; margin-top: 30px; }
          h3 { color: #34495e; background-color: #ecf0f1; padding: 5px; margin-bottom: 5px; }
          .page-break { page-break-before: always; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { border: 1px solid #bdc3c7; padding: 6px; text-align: left; }
          th { background-color: #ecf0f1; }
        </style>
      </head>
      <body>
        <div class="portada">
          <h1>Directorio Docente Telesecundaria Morelos 2026</h1>
          <p>Fecha de generación: ${fecha}</p>
          <div class="resumen">
            <p><strong>Total Maestros:</strong> ${maestros.length}</p>
            <p><strong>Total Escuelas:</strong> ${escuelasTotales}</p>
            <p><strong>Total Municipios:</strong> ${municipiosTotales}</p>
          </div>
        </div>
        
        <div class="page-break"></div>
        <h2>Índice por Municipio</h2>
        <ul>
          ${municipiosSorted.map(m => `<li>${m} (${byMunicipio[m].length} docentes)</li>`).join("")}
        </ul>
  `;

  municipiosSorted.forEach(muni => {
    htmlCompleto += `<div class="page-break"></div><h2>Municipio: ${muni}</h2>`;
    
    const escuelasMuni: Record<string, Maestro[]> = {};
    byMunicipio[muni].forEach(m => {
      if (!escuelasMuni[m.cct]) escuelasMuni[m.cct] = [];
      escuelasMuni[m.cct].push(m);
    });

    Object.values(escuelasMuni).forEach(docentes => {
      const info = docentes[0];
      htmlCompleto += `
        <div class="escuela">
          <h3>${info.escuela || "Sin Nombre"} (CCT: ${info.cct})</h3>
          <p><strong>Dirección:</strong> ${info.direccion_escuela || "N/A"} | <strong>Teléfono:</strong> ${info.telefono_escuela || "N/A"} | <strong>Zona Escolar:</strong> ${info.zona_escolar || "N/A"}</p>
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Función</th>
                <th>Horas</th>
                <th>Antigüedad</th>
              </tr>
            </thead>
            <tbody>
              ${docentes.map(d => `
                <tr>
                  <td>${d.nombre || "Desconocido"}</td>
                  <td>${d.funcion || "N/A"}</td>
                  <td>${d.horas_asignadas || 0}</td>
                  <td>${d.antiguedad || "N/A"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    });
  });

  htmlCompleto += `
        <div class="page-break"></div>
        <h2>Fuentes Consultadas</h2>
        <ul>
          <li>datos.gob.mx - Directorio de Escuelas</li>
          <li>SEP - Consulta Datos Escuelas</li>
          <li>IEBEM - Transparencia</li>
          <li>Transparencia Morelos</li>
          <li>SAIMEX</li>
        </ul>
      </body>
    </html>
  `;

  let browser;
  try {
    browser = await puppeteer.launch({ 
      args: ["--no-sandbox", "--disable-setuid-sandbox"] 
    });
    const page = await browser.newPage();
    await page.setContent(htmlCompleto, { waitUntil: "networkidle0" });
    await page.pdf({ 
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" }
    });
  } finally {
    if (browser) await browser.close();
  }
}
