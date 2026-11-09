/**
 * Diferencias entre dos estados confirmados → eventos con identidad estable.
 * Reglas de seguridad: un dato que desaparece, una lista incompleta, una fecha
 * vencida o un acta ausente NUNCA producen por sí solos un aviso de desierta,
 * cancelación, adjudicación ni de partidas retiradas.
 */
import { createHash } from "crypto";
import { diffCalendars } from "../procurement-calendar/diff";
import { formatLocalMilestone } from "../procurement-calendar/format";
import type { WatchContract, WatchEvent, WatchSnapshot, WatchedProcedure } from "./types";

const sha = (value: string): string => createHash("sha1").update(value).digest("hex").slice(0, 12);
export const eventIdFor = (procedure: string, ...parts: Array<string | number | null | undefined>): string =>
  `${procedure}|${parts.map((part) => String(part ?? "")).join("|")}`;

const money = (value: number | null, currency: string | null): string =>
  value === null ? "no publicado" : `$${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? "moneda por confirmar"}`;

export function contractLines(contract: WatchContract, currencyFallback: string | null): string[] {
  const currency = contract.moneda ?? currencyFallback;
  const lines = [
    `Proveedor: ${contract.licitante ?? "no publicado"}`,
    `Contrato: ${contract.numero ?? contract.id}${contract.estatus ? ` · ${contract.estatus}` : ""}`,
    `Monto sin impuestos: mínimo ${money(contract.importeMin, currency)} · máximo ${money(contract.importeMax, currency)}`,
  ];
  if (contract.importeMinIva !== null || contract.importeMaxIva !== null) {
    lines.push(`Monto con impuestos: mínimo ${money(contract.importeMinIva, currency)} · máximo ${money(contract.importeMaxIva, currency)}`);
  } else lines.push("IVA: no consta en el portal");
  if (contract.inicio || contract.fin) {
    lines.push(`Vigencia: ${formatLocalMilestone({ at: contract.inicio?.slice(0, 19) ?? null, hasTime: false })} al ${formatLocalMilestone({ at: contract.fin?.slice(0, 19) ?? null, hasTime: false })}`);
  }
  return lines;
}

function partidaLabel(snapshot: WatchSnapshot, n: number): string {
  const partida = snapshot.partidas.find((item) => item.n === n);
  return partida ? `${partida.highlighted ? "⭐ " : ""}${partida.descripcion}` : `Partida ${n}`;
}

/** Resultado por partida: solo lo que el portal publica; lo demás queda como pendiente del acta. */
export function partidaResultLines(snapshot: WatchSnapshot, contracts: WatchContract[]): string[] {
  const lines: string[] = [];
  const mapped = new Set<number>();
  for (const contract of contracts) {
    for (const n of contract.partidas) {
      mapped.add(n);
      lines.push(`${partidaLabel(snapshot, n)} → adjudicada a ${contract.licitante ?? "proveedor no publicado"} (máx. ${money(contract.importeMax, contract.moneda ?? snapshot.currency)})`);
    }
  }
  const unmapped = contracts.filter((contract) => contract.partidas.length === 0);
  const numbered = snapshot.partidas.length > 0 && snapshot.partidas.every((item) => item.n !== null);
  if (numbered && mapped.size > 0) {
    const pending = snapshot.partidas.filter((item) => item.n !== null && !mapped.has(item.n)).map((item) => `${item.highlighted ? "⭐ " : ""}${item.descripcion}`);
    if (pending.length > 0) lines.push(`Partidas sin resultado verificable en el portal (ver acta de fallo): ${pending.join("; ")}`);
  }
  if (unmapped.length > 0) {
    lines.push(`Alcance por partida de ${unmapped.length === 1 ? "este contrato" : "estos contratos"}: pendiente de verificar en el acta de fallo; el portal no publica la correspondencia.`);
  }
  return lines;
}

export function diffWatchSnapshots(watched: WatchedProcedure, prev: WatchSnapshot, next: WatchSnapshot): WatchEvent[] {
  const events: WatchEvent[] = [];
  const id = (...parts: Array<string | number | null | undefined>) => eventIdFor(watched.procedure, ...parts);
  const knownDocs = new Set(prev.documents.map((doc) => doc.id));
  const knownContracts = new Map(prev.contracts.map((contract) => [contract.id, contract]));

  // 1) Calendario (misma identidad que el calendario: `cal|<hito>:<fecha>`).
  for (const change of diffCalendars(prev.calendar, next.calendar)) {
    if (change.kind === "acta_fallo") continue; // lo cubre el evento de fallo
    if (change.kind === "aviso" && change.notice) {
      events.push({
        eventId: id("cal", change.dedupeKey), kind: "aviso_calendario", highlighted: false, documentId: change.notice.id,
        title: `Aviso oficial de ${change.notice.kind === "suspension" ? "suspensión" : change.notice.kind === "diferimiento" ? "diferimiento" : "cambio"} (${change.label})`,
        details: [`Documento: ${change.notice.title}${change.notice.at ? ` (${formatLocalMilestone({ at: change.notice.at, hasTime: true })})` : ""}`,
          "La nueva fecha consta en el aviso; el cronograma del portal puede seguir mostrando la anterior."],
      });
    } else {
      events.push({
        eventId: id("cal", change.dedupeKey), kind: change.kind === "new" ? "fecha_nueva" : "fecha_modificada", highlighted: false,
        title: change.kind === "new" ? `${change.label}: ya tiene fecha` : `${change.label}: cambió la fecha`,
        details: [change.kind === "new" ? `Antes: Sin publicar → Ahora: ${formatLocalMilestone(change.next)} CDMX` : `Antes: ${formatLocalMilestone(change.previous)} → Ahora: ${formatLocalMilestone(change.next)} CDMX`],
      });
    }
  }

  // 2) Fallo: acta de fallo nueva y/o estatus explícito del portal, con sus contratos.
  const newActa = next.documents.find((doc) => doc.category === "acta_fallo" && !knownDocs.has(doc.id));
  const statusChanged = next.portalStatus !== null && next.portalStatus !== prev.portalStatus;
  const resultStatus = statusChanged && ["adjudicado", "desierto", "cancelado"].includes(next.statusKind);
  const newContracts = next.contracts.filter((contract) => !knownContracts.has(contract.id));
  const fallo = Boolean(newActa) || (resultStatus && next.statusKind !== "cancelado");
  if (fallo) {
    const status = next.statusKind === "adjudicado" ? "adjudicado" : next.statusKind === "desierto" ? "desierto" : "sin resultado definitivo en el portal";
    const mapped = new Set(next.contracts.flatMap((c) => c.partidas));
    const mappingVerified = next.partidasComplete && next.partidas.length > 0 && next.partidas.every((p) => p.n !== null) &&
      next.contracts.length > 0 && next.contracts.every((c) => c.partidas.length > 0) &&
      [...mapped].every((n) => next.partidas.some((p) => p.n === n));
    const explicitPartial = /parcial/i.test(next.portalStatus ?? "");
    const explicitTotal = /total/i.test(next.portalStatus ?? "");
    const total = next.statusKind !== "adjudicado" ? null : explicitPartial ? "parcial" : explicitTotal ? "total" :
      mappingVerified ? (mapped.size === next.partidas.length ? "total" : "parcial") : "por confirmar en el acta";
    const details = [`Fallo emitido · estatus del portal: ${next.portalStatus ?? "no publicado"} (${status}${total ? `, resultado ${total}` : ""})`];
    if (newActa) details.push(`Acta de fallo: ${newActa.nombre ?? newActa.descripcion}${newActa.createdAt ? ` (${formatLocalMilestone({ at: newActa.createdAt, hasTime: true })} CDMX)` : ""}`);
    const contracts = next.contracts.length > 0 ? next.contracts : [];
    for (const contract of contracts) details.push(...contractLines(contract, next.currency));
    details.push(...partidaResultLines(next, contracts));
    if (newActa) details.push("Participantes, ofertas, desechamientos y motivos constan solo en el acta (PDF protegido con CAPTCHA): documento pendiente de revisión.");
    if (next.statusKind === "desierto") details.push("Partidas desiertas: según el estatus del portal; el detalle por partida consta en el acta.");
    events.push({
      eventId: id("fallo", newActa?.id ?? next.portalStatus), kind: "fallo", highlighted: next.partidas.some((p) => p.highlighted),
      title: "Fallo emitido", details, documentId: newActa?.id,
    });
  } else if (statusChanged && next.statusKind === "cancelado") {
    events.push({ eventId: id("estatus", "cancelado"), kind: "estatus", title: "Procedimiento cancelado (estatus explícito del portal)", details: [`Estatus del portal: ${next.portalStatus}`], highlighted: false });
  } else if (statusChanged && next.statusKind === "vigente" && prev.statusKind !== "vigente") {
    events.push({ eventId: id("estatus", next.portalStatus), kind: "estatus", title: "Procedimiento de nuevo vigente (reposición o relanzamiento)", details: [`Estatus del portal: ${next.portalStatus}`], highlighted: false });
  }

  // 3) Documentos nuevos o modificados (los avisos de calendario ya salen por la vía de fechas).
  // Una adición verificable no depende de que las listas anteriores estén completas.
  {
    const labels: Record<string, [WatchEvent["kind"], string]> = {
      bases_anexos: ["bases_anexos", "Bases o anexos: documento nuevo"], acta_junta: ["acta_junta", "Acta de junta de aclaraciones publicada"],
      acta_apertura: ["acta_apertura", "Acta de presentación y apertura de proposiciones publicada"],
      contrato: ["contrato", "Contrato publicado"], convenio: ["convenio", "Convenio modificatorio publicado"], otro: ["bases_anexos", "Documento nuevo en el expediente"],
    };
    const prevById = new Map(prev.documents.map((doc) => [doc.id, doc]));
    for (const doc of next.documents) {
      if (doc.category === "aviso" || doc.category === "acta_fallo") continue;
      const before = prevById.get(doc.id);
      const [kind, title] = labels[doc.category] ?? labels.otro;
      const detail = `Documento: ${doc.descripcion}${doc.nombre ? ` (${doc.nombre})` : ""}${doc.createdAt ? ` · ${formatLocalMilestone({ at: doc.createdAt, hasTime: true })} CDMX` : ""}`;
      const technical = doc.category === "bases_anexos" ? "Cambios técnicos (software, trazabilidad por lote, integración con sistemas de BIRMEX, inventarios, cadena de frío): documento pendiente de revisión; el PDF no es legible sin CAPTCHA." : null;
      const apertura = doc.category === "acta_apertura" ? "Participantes y ofertas constan en el acta (PDF protegido con CAPTCHA): documento pendiente de revisión." : null;
      if (!before) {
        events.push({ eventId: id("doc", doc.id, doc.modifiedAt ?? doc.createdAt), kind, title, details: [detail, ...(technical ? [technical] : []), ...(apertura ? [apertura] : [])], highlighted: false, documentId: doc.id });
      } else if (before.modifiedAt && doc.modifiedAt && before.modifiedAt !== doc.modifiedAt) {
        events.push({
          eventId: id("doc", doc.id, doc.modifiedAt), kind: "documento_modificado", title: "Documento modificado en el expediente",
          details: [detail, `Modificado: ${formatLocalMilestone({ at: before.modifiedAt, hasTime: true })} → ${formatLocalMilestone({ at: doc.modifiedAt, hasTime: true })} CDMX`, ...(technical ? [technical] : [])],
          highlighted: false, documentId: doc.id,
        });
      }
    }
  }

  // 4) Contratos y convenios (siguen después del fallo). Los contratos del fallo ya van en ese aviso.
  for (const contract of next.contracts) {
    const before = knownContracts.get(contract.id);
    if (!before) {
      if (fallo && newContracts.includes(contract)) continue;
      events.push({ eventId: id("contrato", contract.id, contract.estatus), kind: "contrato", title: /formaliz|firmad|vigente/i.test(contract.estatus ?? "") ? "Contrato formalizado" : "Contrato registrado en el portal", details: contractLines(contract, next.currency), highlighted: false });
    } else {
      const fingerprint = [contract.estatus, contract.importeMin, contract.importeMax, contract.inicio, contract.fin, contract.licitante].join("|");
      const previous = [before.estatus, before.importeMin, before.importeMax, before.inicio, before.fin, before.licitante].join("|");
      if (fingerprint !== previous) {
        const changes: string[] = [];
        if (before.estatus !== contract.estatus) changes.push(`Estatus: ${before.estatus ?? "n/d"} → ${contract.estatus ?? "n/d"}`);
        if (before.importeMax !== contract.importeMax || before.importeMin !== contract.importeMin) changes.push(`Monto máximo: ${money(before.importeMax, before.moneda)} → ${money(contract.importeMax, contract.moneda ?? next.currency)}`);
        if (before.fin !== contract.fin || before.inicio !== contract.inicio) changes.push("Vigencia modificada");
        if (before.licitante !== contract.licitante) changes.push(`Proveedor: ${before.licitante ?? "n/d"} → ${contract.licitante ?? "n/d"}`);
        events.push({ eventId: id("contrato_mod", contract.id, sha(fingerprint)), kind: "contrato_modificado", title: "Contrato modificado (posible convenio modificatorio)", details: [...changes, ...contractLines(contract, next.currency)], highlighted: false });
      }
    }
  }

  // 5) Partidas: solo con listas completas en ambos lados; nunca por desaparición.
  if (next.partidasComplete && prev.partidasComplete) {
    const fingerprint = (list: WatchSnapshot["partidas"]) => list.map((p) => `${p.key}:${p.minMonto}:${p.maxMonto}:${p.descripcion}`).sort().join("|");
    if (fingerprint(next.partidas) !== fingerprint(prev.partidas)) {
      const before = new Map(prev.partidas.map((p) => [p.key, p]));
      const details: string[] = [];
      for (const p of next.partidas) {
        const old = before.get(p.key);
        if (!old) details.push(`${p.highlighted ? "⭐ " : ""}Partida nueva: ${p.descripcion}`);
        else if (old.maxMonto !== p.maxMonto || old.minMonto !== p.minMonto) details.push(`${p.highlighted ? "⭐ " : ""}${p.descripcion}: monto máximo ${money(old.maxMonto, next.currency)} → ${money(p.maxMonto, next.currency)}`);
        if (old && old.descripcion !== p.descripcion) details.push(`${p.highlighted ? "⭐ " : ""}Descripción de partida: ${old.descripcion} → ${p.descripcion}`);
      }
      if (details.length > 0) events.push({ eventId: id("partidas", sha(fingerprint(next.partidas))), kind: "partidas_modificadas", title: "Partidas modificadas", details, highlighted: next.partidas.some((p) => p.highlighted), });
    }
  }

  // 6) Descripción del procedimiento (requisitos técnicos).
  if (next.descriptionHash !== prev.descriptionHash) {
    const added = next.technicalFlags.filter((flag) => !prev.technicalFlags.includes(flag));
    events.push({
      eventId: id("desc", next.descriptionHash), kind: "descripcion_modificada", title: "Descripción del procedimiento modificada", highlighted: false,
      details: [added.length > 0 ? `Temas técnicos nuevos en la descripción: ${added.join(", ")}` : "Cambió el texto de la descripción; revisar requisitos técnicos en el expediente."],
    });
  }
  return events;
}
