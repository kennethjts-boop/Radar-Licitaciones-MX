import {
  activateWatchdogForSentAlert,
  reconcileWatchdogFromSentAlerts,
} from "../auto-activation";
import { activateWatchdogTarget, listPersistentTargets } from "../target-manager";

import { requestWatchdogConsent, activateApprovedConsent } from "../consent";
import { getWatchdogConsent } from "../consent-store";
jest.mock("../consent", () => ({ requestWatchdogConsent: jest.fn(), activateApprovedConsent: jest.fn() }));
jest.mock("../consent-store", () => ({ getWatchdogConsent: jest.fn() }));

const mockState = {
  alert: {
    id: "alert-1",
    procurement_id: "proc-1",
    radar_id: "radar-1",
    alert_type: "new_match",
    telegram_status: "sent",
    created_at: "2026-10-15T08:00:00Z",
    sent_at: "2026-10-15T08:05:00Z",
    radars: { key: "imss_limpieza_20261014", is_active: true },
    procurements: { publication_date: "2026-10-15" },
  },
  hasMatch: true,
};

jest.mock("../../../storage/client", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        order: () => query,
        maybeSingle: async () => ({
          data: table === "alerts" ? mockState.alert : null,
          error: null,
        }),
        limit: async () => ({
          data: table === "matches"
            ? (mockState.hasMatch ? [{ id: "match-oct" }] : [])
            : (table === "alerts" ? [mockState.alert] : []),
          error: null,
        }),
      };
      return query;
    },
  }),
}));
jest.mock("../target-manager", () => ({
  activateWatchdogTarget: jest.fn(),
  listPersistentTargets: jest.fn(),
}));

describe("watchdog pide autorización por alerta enviada", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getWatchdogConsent as jest.Mock).mockResolvedValue(null);
    (requestWatchdogConsent as jest.Mock).mockResolvedValue(true);
    mockState.alert.telegram_status = "sent";
    mockState.alert.created_at = "2026-10-15T08:00:00Z";
    mockState.alert.sent_at = "2026-10-15T08:05:00Z";
    mockState.alert.radars.key = "imss_limpieza_20261014";
    mockState.alert.radars.is_active = true;
    mockState.alert.procurements.publication_date = "2026-10-15";
    mockState.hasMatch = true;
    (listPersistentTargets as jest.Mock).mockResolvedValue([]);
    (activateWatchdogTarget as jest.Mock).mockResolvedValue({ active: true });
  });

  it("pide autorización sin activar después de la entrega válida", async () => {
    expect(await activateWatchdogForSentAlert("alert-1")).toBe(true);
    expect(requestWatchdogConsent).toHaveBeenCalledWith("proc-1", "proc-1");
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("no vuelve a preguntar tras un No y no activa", async () => {
    (getWatchdogConsent as jest.Mock).mockResolvedValue({ status: "declined" });
    expect(await reconcileWatchdogFromSentAlerts()).toBe(0);
    expect(requestWatchdogConsent).not.toHaveBeenCalled();
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("sólo recupera el alta cuando ya existe aprobación", async () => {
    const consent = { status: "approved" };
    (getWatchdogConsent as jest.Mock).mockResolvedValue(consent);
    (activateApprovedConsent as jest.Mock).mockResolvedValue(true);
    expect(await activateWatchdogForSentAlert("alert-1")).toBe(true);
    expect(activateApprovedConsent).toHaveBeenCalledWith(consent);
    expect(requestWatchdogConsent).not.toHaveBeenCalled();
  });

  it("no activa alerta pendiente ni publicada antes del corte", async () => {
    mockState.alert.telegram_status = "pending";
    expect(await activateWatchdogForSentAlert("alert-1")).toBe(false);
    mockState.alert.telegram_status = "sent";
    mockState.alert.procurements.publication_date = "2026-09-30";
    expect(await activateWatchdogForSentAlert("alert-1")).toBe(false);
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("no activa coincidencias anteriores a la versión de octubre ni radar inactivo", async () => {
    mockState.hasMatch = false;
    expect(await activateWatchdogForSentAlert("alert-1")).toBe(false);
    mockState.hasMatch = true;
    mockState.alert.radars.is_active = false;
    expect(await activateWatchdogForSentAlert("alert-1")).toBe(false);
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("no reactiva una vigilancia desactivada después de la alerta", async () => {
    (listPersistentTargets as jest.Mock).mockResolvedValue([{
      procurementId: "proc-1",
      active: false,
      deactivatedAt: "2026-10-15T09:00:00Z",
    }]);
    expect(await reconcileWatchdogFromSentAlerts()).toBe(0);
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("la conciliación recupera una alerta enviada con alta pendiente", async () => {
    expect(await reconcileWatchdogFromSentAlerts()).toBe(1);
    expect(requestWatchdogConsent).toHaveBeenCalledTimes(1);
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });
});
