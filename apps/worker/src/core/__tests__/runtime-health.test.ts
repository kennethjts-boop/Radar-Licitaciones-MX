import {
  getRuntimeHealthSnapshot,
  resetRuntimeHealthForTests,
  setBootstrapRuntimeStatus,
  setDatabaseRuntimeStatus,
  setTelegramPollingRuntimeStatus,
} from "../runtime-health";

describe("runtime health", () => {
  beforeEach(() => {
    resetRuntimeHealthForTests();
  });

  it("permanece liveness ok mientras el bootstrap está pendiente", () => {
    expect(getRuntimeHealthSnapshot()).toMatchObject({
      status: "ok",
      bootstrap: "pending",
      telegramPolling: "disabled",
      db: "unknown",
    });
  });

  it("expone estados degradados como información sin cambiar status", () => {
    setBootstrapRuntimeStatus("failed");
    setDatabaseRuntimeStatus("error");
    setTelegramPollingRuntimeStatus("degraded");

    expect(getRuntimeHealthSnapshot()).toMatchObject({
      status: "ok",
      bootstrap: "failed",
      telegramPolling: "degraded",
      db: "error",
    });
  });
});
