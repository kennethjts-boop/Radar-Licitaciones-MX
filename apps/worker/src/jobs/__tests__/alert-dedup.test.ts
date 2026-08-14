import { shouldSkipDuplicateProcurementAlert } from "../collect.job";

describe("deduplicación de alertas por identidad canónica", () => {
  it("dos perfiles superpuestos no habilitan una segunda alerta del mismo procurement", () => {
    const sent = new Set<string>();
    const procurementId = "procurement-canonico-imss-morelos";

    expect(shouldSkipDuplicateProcurementAlert(sent, procurementId)).toBe(false);
    sent.add(procurementId); // primera entrega (IMSS Morelos)
    expect(shouldSkipDuplicateProcurementAlert(sent, procurementId)).toBe(true);
    // El segundo match (Morelos General) se persiste, pero no vuelve a Telegram.
  });
});
