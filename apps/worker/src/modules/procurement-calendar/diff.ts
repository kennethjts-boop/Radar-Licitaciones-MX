/** Diferencias entre dos calendarios confirmados. Pura y determinista. */
import {
  MILESTONE_KEYS, MILESTONE_LABELS, type CalendarChange, type CalendarSnapshot, type MilestoneValue,
} from "./types";

/**
 * Un cambio por cada fecha nueva o modificada, aviso oficial nuevo o acta de
 * fallo nueva. Una fecha que desaparece del portal NO se reporta: se conserva
 * el último valor confirmado (un hueco del portal no es un cambio).
 * `dedupeKey` incluye el valor nuevo, así que volver a ver el mismo valor no
 * genera otro aviso y una nueva modificación sí.
 */
export function diffCalendars(previous: CalendarSnapshot, next: CalendarSnapshot): CalendarChange[] {
  const changes: CalendarChange[] = [];
  for (const key of MILESTONE_KEYS) {
    if (!next.verified.includes(key)) continue;
    const before = previous.milestones[key];
    const after = next.milestones[key];
    if (!after.at || before.at === after.at) continue;
    changes.push({
      dedupeKey: `${key}:${after.at}`,
      kind: before.at ? "modified" : "new",
      label: MILESTONE_LABELS[key],
      previous: before.at ? before : null,
      next: after,
    });
  }
  const before = previous.submissionDeadline;
  const after = next.submissionDeadline;
  if (after?.at && before?.at !== after.at) {
    changes.push({
      dedupeKey: `limite_entrega:${after.at}`, kind: before?.at ? "modified" : "new",
      label: "Fecha límite de entrega de proposiciones", previous: before?.at ? before : null, next: after,
    });
  }
  const knownNotices = new Set(previous.clarificationNotices.map((notice) => notice.id));
  for (const notice of next.clarificationNotices) {
    if (knownNotices.has(notice.id)) continue;
    changes.push({
      dedupeKey: `aviso:${notice.id}`, kind: "aviso", label: "Junta de aclaraciones", previous: null, next: null, notice,
    });
  }
  if (next.falloActa && previous.falloActa?.id !== next.falloActa.id) {
    changes.push({
      dedupeKey: `acta_fallo:${next.falloActa.id}`, kind: "acta_fallo", label: "Acta de fallo", previous: null, next: null,
      notice: { id: next.falloActa.id, title: next.falloActa.title, at: next.falloActa.publishedAt, kind: "aviso" },
    });
  }
  return changes;
}

export function sameMilestone(a: MilestoneValue | null, b: MilestoneValue | null): boolean {
  return (a?.at ?? null) === (b?.at ?? null);
}
