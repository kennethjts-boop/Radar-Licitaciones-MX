/**
 * SAMPLE DATA — Datos simulados para pruebas del módulo.
 *
 * Licitación de referencia: IMSS Morelos — Limpieza integral 2026
 * Antecedente: mismo contrato año anterior.
 *
 * Resultado esperado:
 * - Techo estimado: ~$4,850,000 — $5,300,000 MXN
 * - Confianza: MEDIA
 * - Score antecedente: >80
 */

import {
  PublicContractRaw,
  FinancialCeilingReport,
} from "./types";

// ─── Licitación actual (simulada) ─────────────────────────────────────────────

export const SAMPLE_CURRENT_TENDER: PublicContractRaw = {
  numero_licitacion: "LA-050GYR019-E11-2026",
  dependencia: "Instituto Mexicano del Seguro Social — Delegación Morelos",
  unidad_compradora: "IMSS Morelos",
  objeto_contratacion:
    "Servicio de limpieza integral en unidades médicas del IMSS Morelos",
  procedimiento: "Licitación Pública Nacional",
  fecha_publicacion: "2026-03-01",
  moneda: "MXN",
  url_fuente: "https://comprasmx.buengobierno.gob.mx/siete/concursos/LA-050GYR019-E11-2026",
  nombre_documento: "Convocatoria pública — IMSS Morelos 2026",
  texto_evidencia: "Licitación pública para servicio de limpieza integral...",
};

// ─── Antecedente inmediato (simulado) ─────────────────────────────────────────

export const SAMPLE_PRECEDENT: PublicContractRaw = {
  numero_expediente: "EXP-IMSS-MOR-2025-0089",
  numero_licitacion: "LA-050GYR019-E09-2025",
  dependencia: "Instituto Mexicano del Seguro Social — Delegación Morelos",
  unidad_compradora: "IMSS Morelos",
  objeto_contratacion:
    "Servicio de limpieza integral en unidades médicas del IMSS Morelos",
  procedimiento: "Licitación Pública Nacional",
  fecha_publicacion: "2025-02-15",
  fecha_fallo: "2025-03-10",
  fecha_contrato: "2025-03-14",
  proveedor_ganador: "Servicios Integrales del Centro S.A. de C.V.",
  monto_contrato: 4620000,
  moneda: "MXN",
  url_fuente:
    "https://comprasmx.buengobierno.gob.mx/siete/concursos/LA-050GYR019-E09-2025",
  nombre_documento: "Fallo y contrato — IMSS Morelos 2025",
  texto_evidencia:
    "Contrato adjudicado a Servicios Integrales del Centro S.A. de C.V. por $4,620,000.00 MXN para servicio de limpieza integral en unidades médicas del IMSS Morelos durante 2025.",
  confianza_extraccion: "ALTA",
};

// ─── Otros candidatos históricos ──────────────────────────────────────────────

export const SAMPLE_HISTORICAL_CANDIDATES: PublicContractRaw[] = [
  SAMPLE_PRECEDENT,
  {
    numero_licitacion: "LA-050GYR019-E07-2024",
    dependencia: "IMSS Morelos",
    unidad_compradora: "IMSS Morelos",
    objeto_contratacion: "Limpieza integral unidades médicas Morelos",
    fecha_contrato: "2024-03-20",
    proveedor_ganador: "Servicios Integrales del Centro S.A. de C.V.",
    monto_contrato: 4310000,
    moneda: "MXN",
    url_fuente: "https://comprasmx.buengobierno.gob.mx/siete/concursos/LA-050GYR019-E07-2024",
    nombre_documento: "Fallo IMSS Morelos 2024",
    texto_evidencia: "Adjudicación servicio de limpieza 2024 IMSS Morelos",
    confianza_extraccion: "ALTA",
  },
  {
    numero_licitacion: "LA-050GYR019-E05-2023",
    dependencia: "IMSS Morelos",
    unidad_compradora: "IMSS Morelos",
    objeto_contratacion: "Servicio de limpieza en instalaciones médicas Morelos",
    fecha_contrato: "2023-04-01",
    proveedor_ganador: "Grupo Limpie MX S.A. de C.V.",
    monto_contrato: 3980000,
    moneda: "MXN",
    url_fuente: "https://comprasmx.buengobierno.gob.mx/siete/concursos/LA-050GYR019-E05-2023",
    nombre_documento: "Fallo IMSS Morelos 2023",
    texto_evidencia: "Adjudicación limpieza IMSS Morelos 2023",
    confianza_extraccion: "MEDIA",
  },
];

// ─── Reporte esperado (para validación) ──────────────────────────────────────

export const EXPECTED_SAMPLE_RESULT = {
  query: "LA-050GYR019-E11-2026",
  expectedConfidence: "MEDIA" as const,
  expectedCeilingMin: 4_850_000,
  expectedCeilingMax: 5_300_000,
  expectedPrecedentSupplier: "Servicios Integrales del Centro S.A. de C.V.",
  expectedPrecedentAmount: 4_620_000,
  expectedMinScore: 80,
};
