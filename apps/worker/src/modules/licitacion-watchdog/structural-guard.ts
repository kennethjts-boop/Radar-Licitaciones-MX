import { nowISO } from "../../core/time";
import { isEmptyResultsPlaceholder, snapshotStructureSignature } from "./snapshot";
import type { WatchdogSnapshot } from "./types";

const SIGNIFICANT_LOSS_RATIO = 0.5;

interface PendingStructuralLoss {
  signature: string;
  captures: number;
}

export interface StructuralLossAnalysis {
  suspicious: boolean;
  /** Una tabla con filas reales pasó a mostrar sólo la fila de relleno. */
  transientEmpty: boolean;
  reasons: string[];
  signature: string;
}

export type StructuralGuardDecision =
  | { action: "accept"; analysis: StructuralLossAnalysis }
  | { action: "reject_incomplete"; analysis: StructuralLossAnalysis }
  | { action: "await_confirmation"; analysis: StructuralLossAnalysis; captures: 1 }
  | { action: "confirmed"; analysis: StructuralLossAnalysis; captures: 2; confirmedAt: string };

function tableKey(headers: string[], occurrence: number): string {
  return `${JSON.stringify(headers)}#${occurrence}`;
}

interface IndexedTable {
  rows: number;
  placeholder: boolean;
}

function indexTables(snapshot: WatchdogSnapshot): Map<string, IndexedTable> {
  const occurrences = new Map<string, number>();
  const tables = new Map<string, IndexedTable>();

  for (const table of snapshot.visibleTables) {
    const headers = JSON.stringify(table.headers);
    const occurrence = occurrences.get(headers) ?? 0;
    occurrences.set(headers, occurrence + 1);
    const placeholder = isEmptyResultsPlaceholder(table);
    tables.set(tableKey(table.headers, occurrence), {
      rows: placeholder ? 0 : table.rows.length,
      placeholder,
    });
  }
  return tables;
}

function isSignificantLoss(previousCount: number, currentCount: number): boolean {
  if (previousCount <= 0 || currentCount >= previousCount) return false;
  return (previousCount - currentCount) / previousCount >= SIGNIFICANT_LOSS_RATIO;
}

export function analyzeStructuralLoss(
  previous: WatchdogSnapshot,
  current: WatchdogSnapshot,
): StructuralLossAnalysis {
  const reasons: string[] = [];
  let transientEmpty = false;
  const previousTables = indexTables(previous);
  const currentTables = indexTables(current);

  for (const [key, { rows: previousRows }] of previousTables) {
    if (previousRows === 0) continue;
    const currentTable = currentTables.get(key);
    if (currentTable === undefined) {
      reasons.push(`tabla ausente (${previousRows} filas previas)`);
      continue;
    }
    const currentRows = currentTable.rows;
    if (currentRows === 0) {
      if (currentTable.placeholder) transientEmpty = true;
      reasons.push(
        currentTable.placeholder
          ? `tabla sin resultados transitoria (${previousRows} filas previas)`
          : `tabla vacía (${previousRows} filas previas)`,
      );
      continue;
    }
    if (isSignificantLoss(previousRows, currentRows)) {
      reasons.push(`pérdida significativa de filas (${previousRows}→${currentRows})`);
    }
  }

  if (isSignificantLoss(previous.documents.length, current.documents.length)) {
    reasons.push(
      `pérdida significativa de documentos (${previous.documents.length}→${current.documents.length})`,
    );
  }

  return {
    suspicious: reasons.length > 0,
    transientEmpty,
    reasons,
    signature: snapshotStructureSignature(current),
  };
}

export class StructuralChangeGuard {
  private readonly pending = new Map<string, PendingStructuralLoss>();

  evaluate(
    numeroProcedimiento: string,
    previous: WatchdogSnapshot,
    current: WatchdogSnapshot,
  ): StructuralGuardDecision {
    const analysis = analyzeStructuralLoss(previous, current);

    // La fila de relleno sustituye filas reales sólo durante la hidratación:
    // nunca se confirma como cambio, o el expediente alterna lleno/vacío.
    if (current.partial !== false || analysis.transientEmpty) {
      this.pending.delete(numeroProcedimiento);
      return { action: "reject_incomplete", analysis };
    }

    if (!analysis.suspicious) {
      this.pending.delete(numeroProcedimiento);
      return { action: "accept", analysis };
    }

    const pending = this.pending.get(numeroProcedimiento);
    if (!pending || pending.signature !== analysis.signature) {
      this.pending.set(numeroProcedimiento, { signature: analysis.signature, captures: 1 });
      return { action: "await_confirmation", analysis, captures: 1 };
    }

    this.pending.delete(numeroProcedimiento);
    return {
      action: "confirmed",
      analysis,
      captures: 2,
      confirmedAt: nowISO(),
    };
  }

  reset(): void {
    this.pending.clear();
  }
}

export const structuralChangeGuard = new StructuralChangeGuard();
