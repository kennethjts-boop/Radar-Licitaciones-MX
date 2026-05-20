import { buildExternalSourceAdapters } from "./source-adapters";
import { runExternalDiscoveryPipeline } from "./pipeline";
import type { ExternalLeadRunOptions } from "./types";

export async function discoverExternalLeadCandidates(options: ExternalLeadRunOptions) {
  const adapters = buildExternalSourceAdapters(options);
  return runExternalDiscoveryPipeline(adapters, options);
}

export const ALLOWED_EXTERNAL_SOURCE_FAMILIES = [
  "DOF",
  "Plataforma Nacional de Transparencia / SIPOT",
  "datos.gob.mx",
  "gacetas y periodicos oficiales estatales",
  "RSS y feeds publicos institucionales",
  "PDF publicos con limite de tamano y timeout",
  "portales estatales y municipales de transparencia",
  "padrones publicos de proveedores y contratistas",
  "sitios oficiales de dependencias",
  "convocatorias publicas institucionales",
  "historicos de adjudicaciones, contratos y fallos",
];
