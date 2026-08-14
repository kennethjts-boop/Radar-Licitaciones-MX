import { resolveHistoricalRadarContext } from "../radar-config-history";

describe("historia inmutable de configuración radar", () => {
  it("mantiene A en el match histórico y muestra B únicamente en el posterior", () => {
    const mutableSlotNow = {
      key: "imss_bienestar_morelos",
      name: "IMSS — Oaxtepec, Morelos",
    };
    const historicalMatch = {
      radar_config_versions: {
        radar_key: "imss_bienestar_morelos",
        radar_name: "IMSS Bienestar — Morelos (Hospitales Comunitarios)",
      },
    };
    const laterMatch = {
      radar_config_versions: {
        radar_key: mutableSlotNow.key,
        radar_name: mutableSlotNow.name,
      },
    };

    expect(resolveHistoricalRadarContext(historicalMatch)).toEqual({
      key: "imss_bienestar_morelos",
      name: "IMSS Bienestar — Morelos (Hospitales Comunitarios)",
    });
    expect(resolveHistoricalRadarContext(laterMatch)).toEqual(mutableSlotNow);
  });
});
