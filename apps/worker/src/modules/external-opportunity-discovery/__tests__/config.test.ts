import {
  getExternalOsintOperationalView,
  isExternalOsintEnabled,
} from "../config";

describe("External OSINT runtime config", () => {
  it("solo se habilita con ENABLE_EXTERNAL_LEADS_OSINT=true", () => {
    expect(
      isExternalOsintEnabled({ ENABLE_EXTERNAL_LEADS_OSINT: true }),
    ).toBe(true);
    expect(
      isExternalOsintEnabled({ ENABLE_EXTERNAL_LEADS_OSINT: false }),
    ).toBe(false);
  });

  it("ignora telemetría histórica cuando está deshabilitado", () => {
    const view = getExternalOsintOperationalView(
      {
        ENABLE_EXTERNAL_LEADS_OSINT: false,
        EXTERNAL_LEADS_DRY_RUN: false,
        EXTERNAL_LEADS_DISCOVERY_MODE: true,
      },
      {
        status: "error",
        sourcesReviewed: 40,
        rawResultsReceived: 386,
        detected: 20,
        errors: ["certificate error"],
        topErrors: [{ message: "certificate error" }],
        topDiscardedCandidates: [{ title: "old candidate" }],
      },
    );

    expect(view).toMatchObject({
      disabled: true,
      status: "disabled",
      reason: "disabled_by_env",
      discoveryMode: false,
      sourcesReviewed: 0,
      rawResultsReceived: 0,
      detected: 0,
      saved: 0,
      alerted: 0,
      errors: [],
      topErrors: [],
      topDiscardedCandidates: [],
    });
  });
});
