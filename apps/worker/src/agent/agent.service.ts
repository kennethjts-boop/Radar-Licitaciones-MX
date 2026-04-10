import { createModuleLogger } from "../core/logger";
import { runActiveSearch } from "./search.handler";

const log = createModuleLogger("agent-service");

export interface AgentSearchResult {
  id: string;
  expedienteId: string;
  licitacionNombre: string;
  dependencia: string;
  sourceUrl: string;
  summary?: string;
}

export interface AgentSearchSession {
  chatId: string;
  query: string;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
  options: AgentSearchResult[];
  selectedOptionId?: string;
}

interface SelectionPointer {
  chatId: string;
  selectionKey: string;
  optionId: string;
  query: string;
  createdAt: string;
}

/**
 * Memoria temporal de sesiones activas por chat.
 * Fase 0/1: in-memory para no agregar migraciones al flujo base.
 */
const activeSessions = new Map<string, AgentSearchSession>();
const selectionPointers = new Map<string, SelectionPointer>();

function makeSessionId(chatId: string, query: string): string {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, "-");
  return `${chatId}:${normalizedQuery}:${Date.now()}`;
}

function makeSelectionKey(chatId: string, optionId: string): string {
  const token = Math.random().toString(36).slice(2, 8);
  return `sel:${chatId}:${optionId}:${token}`;
}

export function getSearchSession(chatId: string): AgentSearchSession | null {
  return activeSessions.get(chatId) ?? null;
}

export function saveSearchSession(session: AgentSearchSession): void {
  activeSessions.set(session.chatId, session);
}

export function buildInlineSelectionPointers(
  session: AgentSearchSession,
): Array<{ selectionKey: string; option: AgentSearchResult }> {
  const pointers: Array<{ selectionKey: string; option: AgentSearchResult }> = [];

  for (const option of session.options) {
    const selectionKey = makeSelectionKey(session.chatId, option.id);
    selectionPointers.set(selectionKey, {
      chatId: session.chatId,
      selectionKey,
      optionId: option.id,
      query: session.query,
      createdAt: new Date().toISOString(),
    });
    pointers.push({ selectionKey, option });
  }

  return pointers;
}

export function selectOptionByKey(
  chatId: string,
  selectionKey: string,
): AgentSearchResult | null {
  const pointer = selectionPointers.get(selectionKey);
  if (!pointer || pointer.chatId !== chatId) return null;

  const session = getSearchSession(chatId);
  if (!session) return null;

  const selected = session.options.find((item) => item.id === pointer.optionId);
  if (!selected) return null;

  saveSearchSession({
    ...session,
    selectedOptionId: selected.id,
  });

  log.info(
    { chatId, selectionKey, optionId: selected.id, expedienteId: selected.expedienteId },
    "Agent option selected",
  );

  return selected;
}

export async function startActiveSearch(
  chatId: string,
  query: string,
  onProgress?: (message: string) => void,
): Promise<AgentSearchSession> {
  const session: AgentSearchSession = {
    chatId,
    query,
    status: "running",
    startedAt: new Date().toISOString(),
    options: [],
  };

  saveSearchSession(session);

  try {
    const options = await runActiveSearch({
      searchId: makeSessionId(chatId, query),
      query,
      onProgress,
    });

    const finished: AgentSearchSession = {
      ...session,
      status: "done",
      finishedAt: new Date().toISOString(),
      options,
    };

    saveSearchSession(finished);
    return finished;
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const isTimeout = /timed out after 60000ms/i.test(rawMessage);
    const message = isTimeout
      ? "⚠️ El portal está tardando demasiado. Reintenta en un momento."
      : rawMessage;
    log.error({ err, chatId, query }, "Active search failed");

    const failed: AgentSearchSession = {
      ...session,
      status: "error",
      finishedAt: new Date().toISOString(),
      errorMessage: message,
    };

    saveSearchSession(failed);
    return failed;
  }
}
