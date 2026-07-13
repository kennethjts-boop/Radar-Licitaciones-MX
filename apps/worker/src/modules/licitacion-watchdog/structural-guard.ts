import { nowISO } from "../../core/time";
import { snapshotStructureSignature } from "./snapshot";
import type { WatchdogSnapshot } from "./types";

const SIGNIFICANT_LOSS_RATIO = 0.5;

interface PendingStructuralLoss {
  signature: string;
  captures: number;
}

export interface StructuralLossAnalysis {
  suspicious: boolean;
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

function indexTables(snapshot: WatchdogSnapshot): Map<string, number> {
  const occurrences = new Map<string, number>();
  const tables = new Map<string, number>();

  for (const table of snapshot.visibleTables) {
    const headers = JSON.stringify(table.headers);
    const occurrence = occurrences.get(headers) ?? 0;
    occurrences.set(headers, occurrence + 1);
    tables.set(tableKey(table.headers, occurrence), table.rows.length);
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
  const previousTables = indexTables(previous);
  const currentTables = indexTables(current);

  for (const [key, previousRows] of previousTables) {
    if (previousRows === 0) continue;
    const currentRows = currentTables.get(key);
    if (currentRows === undefined) {
      reasons.push(`tabla ausente (${previousRows} filas previas)`);
      continue;
    }
    if (currentRows === 0) {
      reasons.push(`tabla vacía (${previousRows} filas previas)`);
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

    if (current.partial !== false) {
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
