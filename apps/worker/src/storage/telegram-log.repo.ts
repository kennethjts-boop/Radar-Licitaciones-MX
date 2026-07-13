import { v4 as uuidv4 } from "uuid";
import { nowISO } from "../core/time";
import { getSupabaseClient } from "./client";

interface TelegramLogInput {
  command: string;
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  status: "ok" | "error";
}

export async function writeTelegramLog(input: TelegramLogInput): Promise<void> {
  const { error } = await getSupabaseClient().from("telegram_logs").insert({
    id: uuidv4(),
    command: input.command,
    request_payload: input.requestPayload,
    response_payload: input.responsePayload,
    status: input.status,
    created_at: nowISO(),
  });

  if (error) {
    throw new Error(`No se pudo escribir telegram_logs: ${error.message}`);
  }
}
