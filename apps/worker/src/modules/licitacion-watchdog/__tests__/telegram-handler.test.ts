import type TelegramBot from "node-telegram-bot-api";
import {
  handleNoVigilarCommand,
  handleVigilarCommand,
} from "../telegram-handler";
import {
  addDynamicTarget,
  listPersistentTargets,
  removeDynamicTarget,
} from "../target-manager";
import { getLatestSnapshot } from "../repository";
import { runLicitacionWatchdog } from "../job";

jest.mock("../target-manager", () => ({
  getResolvedTargets: jest.fn(),
  addDynamicTarget: jest.fn(),
  removeDynamicTarget: jest.fn(),
  listPersistentTargets: jest.fn(),
}));
jest.mock("../repository", () => ({
  getLastChangedSnapshot: jest.fn(),
  getLatestSnapshot: jest.fn(),
}));
jest.mock("../job", () => ({ runLicitacionWatchdog: jest.fn() }));

const target = {
  id: "target-1",
  procurementId: "proc-1",
  alias: "IMSS · N-200",
  numero: "LA-50-GYR-050GYR007-N-200-2026",
  uuid: "uuid-200",
  expedienteUrl: "https://comprasmx.example/detalle/uuid-200/procedimiento",
  dependency: "IMSS",
  active: true,
  activatedAt: "2026-08-13T12:00:00Z",
  deactivatedAt: null,
  lastCheckedAt: null,
  lastSnapshotId: null,
};

describe("comandos Telegram watchdog", () => {
  const sendMessage = jest.fn().mockResolvedValue({ message_id: 1 });
  const bot = { sendMessage } as unknown as TelegramBot;

  beforeEach(() => {
    jest.clearAllMocks();
    (listPersistentTargets as jest.Mock).mockResolvedValue([]);
    (addDynamicTarget as jest.Mock).mockResolvedValue(target);
    (getLatestSnapshot as jest.Mock).mockResolvedValue(null);
    (runLicitacionWatchdog as jest.Mock).mockResolvedValue(undefined);
    (removeDynamicTarget as jest.Mock).mockResolvedValue(true);
  });

  it("/vigilar activa el target y programa baseline silencioso", async () => {
    await handleVigilarCommand(bot, "123", target.numero);

    expect(addDynamicTarget).toHaveBeenCalledWith(target.numero);
    expect(runLicitacionWatchdog).toHaveBeenCalledWith([target]);
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain("Watchdog activo");
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain("baseline silencioso");
  });

  it("/vigilar repetido no duplica ni reconstruye un baseline existente", async () => {
    (listPersistentTargets as jest.Mock).mockResolvedValue([target]);
    (getLatestSnapshot as jest.Mock).mockResolvedValue({ id: "snapshot-1" });

    await handleVigilarCommand(bot, "123", target.numero);

    expect(runLicitacionWatchdog).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain("Ya se encuentra bajo vigilancia");
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain("reutiliza el historial");
  });

  it("/novigilar desactiva sin afirmar que elimina historia", async () => {
    await handleNoVigilarCommand(bot, "123", target.numero);

    expect(removeDynamicTarget).toHaveBeenCalledWith(target.numero);
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain("Watchdog desactivado");
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain("historial y los snapshots se conservaron");
  });
});
