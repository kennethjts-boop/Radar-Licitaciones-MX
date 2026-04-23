import ExcelJS from "exceljs";
import { Maestro } from "../types";

export async function generarExcel(maestros: Maestro[]): Promise<void> {
  const outputPath = "output/maestros-morelos.xlsx";
  const workbook = new ExcelJS.Workbook();
  
  // Hoja 1: Maestros
  const sheet1 = workbook.addWorksheet("Maestros");
  sheet1.columns = [
    { header: "Nombre", key: "nombre", width: 30 },
    { header: "CCT", key: "cct", width: 15 },
    { header: "Escuela", key: "escuela", width: 30 },
    { header: "Municipio", key: "municipio", width: 20 },
    { header: "Localidad", key: "localidad", width: 20 },
    { header: "Dirección", key: "direccion_escuela", width: 30 },
    { header: "Teléfono", key: "telefono_escuela", width: 15 },
    { header: "Email", key: "email_institucional", width: 25 },
    { header: "Zona Escolar", key: "zona_escolar", width: 15 },
    { header: "Supervisor", key: "supervisor_zona", width: 25 },
    { header: "Función", key: "funcion", width: 20 },
    { header: "Horas", key: "horas_asignadas", width: 10 },
    { header: "Antigüedad", key: "antiguedad", width: 15 },
    { header: "Fuentes", key: "fuentes_consultadas", width: 40 }
  ];

  maestros.forEach(m => {
    sheet1.addRow({
      ...m,
      fuentes_consultadas: m.fuentes_consultadas.join(", ")
    });
  });

  // Hoja 2: Resumen por municipio
  const sheet2 = workbook.addWorksheet("Por Municipio");
  sheet2.columns = [
    { header: "Municipio", key: "municipio", width: 20 },
    { header: "Total Maestros", key: "totalMaestros", width: 20 },
    { header: "Total Escuelas", key: "totalEscuelas", width: 20 },
    { header: "Total Directores", key: "totalDirectores", width: 20 },
    { header: "Total Docentes", key: "totalDocentes", width: 20 }
  ];
  
  const stats: Record<string, any> = {};
  maestros.forEach(m => {
    const muni = m.municipio || "Desconocido";
    if (!stats[muni]) {
      stats[muni] = { maestros: 0, escuelas: new Set(), directores: 0, docentes: 0 };
    }
    stats[muni].maestros++;
    if (m.cct) stats[muni].escuelas.add(m.cct);
    if (m.funcion && m.funcion.toLowerCase().includes("director")) stats[muni].directores++;
    else stats[muni].docentes++;
  });
  
  Object.entries(stats).forEach(([municipio, data]) => {
    sheet2.addRow({ 
      municipio, 
      totalMaestros: data.maestros,
      totalEscuelas: data.escuelas.size,
      totalDirectores: data.directores,
      totalDocentes: data.docentes
    });
  });

  // Hoja 3: Escuelas sin director
  const sheet3 = workbook.addWorksheet("Sin Director");
  sheet3.columns = [
    { header: "CCT", key: "cct", width: 15 },
    { header: "Escuela", key: "escuela", width: 30 },
    { header: "Municipio", key: "municipio", width: 20 },
    { header: "Teléfono", key: "telefono", width: 15 }
  ];
  
  const directoresPorEscuela: Record<string, boolean> = {};
  maestros.forEach(m => {
    if (m.funcion && m.funcion.toLowerCase().includes("director")) {
      directoresPorEscuela[m.cct] = true;
    }
  });

  const processedCCTs = new Set<string>();
  maestros.forEach(m => {
    if (m.cct && !directoresPorEscuela[m.cct] && !processedCCTs.has(m.cct)) {
      sheet3.addRow({ 
        cct: m.cct, 
        escuela: m.escuela, 
        municipio: m.municipio, 
        telefono: m.telefono_escuela 
      });
      processedCCTs.add(m.cct);
    }
  });

  await workbook.xlsx.writeFile(outputPath);
}
