import type { DeepAnalysisResult } from "./deep-analysis.service";

function sanitizePdfText(input: string): string {
  return input
    .replace(/[()\\]/g, "")
    .replace(/[^\x20-\x7E\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapLine(text: string, maxChars = 90): string[] {
  const words = sanitizePdfText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
      continue;
    }
    current = candidate;
  }

  if (current) lines.push(current);
  return lines;
}

function buildBodyLines(result: DeepAnalysisResult): string[] {
  const r = result.report;
  const lines: string[] = [
    `Expediente de Inteligencia: ${result.title}`,
    "",
    "Resumen Ejecutivo:",
    ...wrapLine(r.resumen),
    "",
    "Analisis RAG CAPUFE:",
    ...wrapLine(r.comparativo_capufe),
    "",
    "Fechas Criticas:",
    ...(r.fechas_criticas.length ? r.fechas_criticas : ["No especificadas"]),
    "",
    "Veredicto de Viabilidad:",
    ...wrapLine(r.veredicto),
    "",
    "Candados Detectados:",
    ...(r.candados_detectados.length ? r.candados_detectados : ["No detectados"]),
  ];

  return lines.flatMap((line) => (line ? wrapLine(line) : [""]));
}

export function generateIntelligencePdf(result: DeepAnalysisResult): Buffer {
  const lines = buildBodyLines(result);
  const yStart = 790;
  const lineHeight = 14;

  const contentOps: string[] = [
    "BT",
    "/F1 12 Tf",
    "50 810 Td",
    `(Expediente de Inteligencia: ${sanitizePdfText(result.title).slice(0, 80)}) Tj`,
    "ET",
    "BT",
    "/F1 10 Tf",
  ];

  let y = yStart;
  for (const line of lines) {
    if (y < 50) break;
    contentOps.push(`50 ${y} Td`);
    contentOps.push(`(${sanitizePdfText(line).slice(0, 110)}) Tj`);
    y -= lineHeight;
  }
  contentOps.push("ET");

  const content = contentOps.join("\n");

  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj");
  objects.push(
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
  );
  objects.push("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj");
  objects.push(
    `5 0 obj << /Length ${Buffer.byteLength(content, "utf8")} >> stream\n${content}\nendstream endobj`,
  );

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${obj}\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += "trailer\n";
  pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += "startxref\n";
  pdf += `${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}
