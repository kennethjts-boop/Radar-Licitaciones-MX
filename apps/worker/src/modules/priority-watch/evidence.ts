/**
 * Contraste con fuentes de respaldo (solo lectura, con tiempo límite): DOF y datos
 * abiertos de contrataciones. Compras MX y sus documentos son la fuente primaria; una
 * fuente de respaldo solo se cita cuando aporta evidencia del MISMO procedimiento.
 */
import axios from "axios";
import { createModuleLogger } from "../../core/logger";
import { fetchContratacionesAbiertas, type OcdsContract } from "../../collectors/contrataciones-abiertas/index";
import type { SourceEvidence } from "./format";
import type { WatchContract, WatchSnapshot, WatchedProcedure } from "./types";

const log = createModuleLogger("priority-watch:evidence");
const DOF_SEARCH = "https://www.dof.gob.mx/busqueda_detalle.php";
const TIMEOUT_MS = 15_000;

export interface EvidenceDeps {
  http?: (url: string) => Promise<string>;
  ocds?: (procedure: string) => Promise<OcdsContract[]>;
  now?: () => Date;
}

const defaultHttp = async (url: string): Promise<string> =>
  (await axios.get<string>(url, { timeout: TIMEOUT_MS, responseType: "text", headers: { "User-Agent": "Radar-Licitaciones-MX/2.0" } })).data;

const defaultOcds = async (procedure: string): Promise<OcdsContract[]> =>
  (await fetchContratacionesAbiertas({ keywords: [procedure], scope: "NATIONAL_CAPUFE_DESIERTA", maxResults: 10 })).contracts;

export async function dofEvidence(watched: WatchedProcedure, deps: EvidenceDeps = {}): Promise<SourceEvidence | null> {
  const url = new URL(DOF_SEARCH);
  url.searchParams.set("textobusqueda", watched.procedure);
  try {
    const html = await (deps.http ?? defaultHttp)(url.toString());
    const hits = (html.match(/nota_detalle\.php\?codigo=\d+/g) ?? []).length;
    if (!html.includes(watched.procedure) || hits === 0) return null;
    return {
      source: "DOF", url: url.toString(), documentDate: null, consultedAt: (deps.now?.() ?? new Date()).toISOString(),
      note: `${hits} publicación(es) que mencionan el folio`,
    };
  } catch (err) {
    log.warn({ err }, "DOF sin respuesta; se omite el contraste");
    return null;
  }
}

/** Diferencias entre el contrato del portal y el de datos abiertos; aplica el documento más reciente. */
export function compareContract(portal: WatchContract, open: OcdsContract): string | null {
  const diffs: string[] = [];
  if (portal.importeMax !== null && open.awardedAmount !== null &&
      Math.abs(portal.importeMax - open.awardedAmount) / Math.max(portal.importeMax, 1) > 0.01) {
    diffs.push(`monto máx. $${portal.importeMax.toLocaleString("es-MX")} (Compras MX) vs $${open.awardedAmount.toLocaleString("es-MX")} (datos abiertos)`);
  }
  const norm = (value: string | null) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (portal.licitante && open.supplier && norm(portal.licitante) !== norm(open.supplier)) {
    diffs.push(`proveedor ${portal.licitante} (Compras MX) vs ${open.supplier} (datos abiertos)`);
  }
  if (diffs.length === 0) return null;
  const portalDate = portal.publicadoAt ?? "";
  const openDate = open.retrievedAt ?? "";
  const winner = portalDate && portalDate >= openDate.slice(0, 19) ? "Compras MX (documento más reciente)" : "datos abiertos (documento más reciente)";
  return `Discrepancia entre fuentes: ${diffs.join("; ")}. Se aplica ${winner}.`;
}

export async function gatherEvidence(
  watched: WatchedProcedure, snapshot: WatchSnapshot, deps: EvidenceDeps = {},
): Promise<SourceEvidence[]> {
  const evidence: SourceEvidence[] = [];
  const now = (deps.now?.() ?? new Date()).toISOString();
  const dof = await dofEvidence(watched, deps);
  if (dof) evidence.push(dof);
  try {
    const open = (await (deps.ocds ?? defaultOcds)(watched.procedure)).filter((item) => item.procedureNumber === watched.procedure);
    for (const item of open.slice(0, 1)) {
      const portal = snapshot.contracts[0];
      evidence.push({
        source: "Datos abiertos (Contrataciones Abiertas)", url: item.sourceUrl ?? "https://contratacionesabiertas.hacienda.gob.mx/",
        documentDate: item.year ? String(item.year) : null, consultedAt: now,
        note: (portal && compareContract(portal, item)) ?? "sin diferencias verificables con Compras MX",
      });
    }
  } catch (err) {
    log.warn({ err }, "Datos abiertos sin respuesta; se omite el contraste");
  }
  return evidence;
}
