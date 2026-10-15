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

  it("/vigilar no activa expedientes manualmente", async () => {
    await handleVigilarCommand(bot, "123", target.numero);

    expect(addDynamicTarget).not.toHaveBeenCalled();
    expect(runLicitacionWatchdog).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain("automáticamente");
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain("no permite altas manuales");
  });

  it("/novigilar desactiva sin afirmar que elimina historia", async () => {
    await handleNoVigilarCommand(bot, "123", target.numero);

    expect(removeDynamicTarget).toHaveBeenCalledWith(target.numero);
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain("Watchdog desactivado");
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain("historial y los snapshots se conservaron");
  });
});
