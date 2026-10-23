import { parseEdomexPage, selectNotice, explicitContractAmount } from "../policy";

describe("selección estatal", () => {
  it("ISSEMyM acepta cualquier giro y monto", () => {
    expect(selectNotice("LPN/ISSEMYM/046/2026", "Papelería, monto estimado: $45,000", "https://portal.secogem.gob.mx/a.pdf")?.category).toBe("issemym");
  });
  it("carreteras exige superar 100M cuando el importe se conoce", () => {
    expect(selectNotice("JCEM-1", "Rehabilitación de carretera, monto estimado: $100,000,000", "https://portal.secogem.gob.mx/a.pdf")).toBeNull();
    expect(selectNotice("JCEM-1", "Rehabilitación de carretera, monto estimado: 101 mdp", "https://portal.secogem.gob.mx/a.pdf")?.amount).toBe(101_000_000);
  });
  it("capital contable y bases nunca se convierten en presupuesto", () => {
    expect(explicitContractAmount("Capital contable $350,000,000, costo de bases $10,000")).toBeNull();
    expect(explicitContractAmount("Monto estimado $200,000,000. Presupuesto autorizado $240,000,000")).toBeNull();
  });
  it("omite proyectos integrales y conserva mantenimiento puntual de Mexibús", () => {
    expect(selectNotice("SITRAMYTEM-06", "Línea 7 del Mexibús, construcción integral", "https://portal.secogem.gob.mx/a.pdf")).toBeNull();
    expect(selectNotice("SITRAMYTEM-07", "Mexicable línea 3 llave en mano", "https://portal.secogem.gob.mx/a.pdf")).toBeNull();
    expect(selectNotice("SITRAMYTEM-26", "Mantenimiento de semáforos de los sistemas Mexibús", "https://portal.secogem.gob.mx/a.pdf")?.category).toBe("carreteras");
    expect(selectNotice("JCEM-10", "Rescate de vialidades de la residencia regional mediante bacheo asfáltico", "https://portal.secogem.gob.mx/a.pdf")?.category).toBe("carreteras");
    expect(selectNotice("MUNICIPIO-10", "Pavimentación de calle Palma de 139 metros", "https://portal.secogem.gob.mx/a.pdf")).toBeNull();
  });
  it("otros giros sin monto requieren indicios de alcance grande", () => {
    expect(selectNotice("OM-01", "Adquisición de una silla", "https://portal.secogem.gob.mx/a.pdf")).toBeNull();
    expect(selectNotice("OM-02", "Servicio integral de limpieza estatal", "https://portal.secogem.gob.mx/a.pdf")?.category).toBe("oportunidades");
    expect(selectNotice("OM-03", "Servicio integral de limpieza, monto estimado $19,000,000", "https://portal.secogem.gob.mx/a.pdf")).toBeNull();
    expect(selectNotice("OM-04", "Servicio integral de limpieza, monto estimado $20,000,000", "https://portal.secogem.gob.mx/a.pdf")?.amount).toBe(20_000_000);
  });
  it("lee el formato real con separador ^ y rechaza PDFs externos", () => {
    const html = `<table>${[1, 2, 3].map(n => `<tr><td>LPN/ISSEMYM/00${n}/2026^/sites/default/files/a${n}.pdf</td><td>ISSEMYM^<p>Adquisición de papelería</p></td></tr>`).join("")}<tr><td>BAD^https://evil.example/a.pdf</td><td>ISSEMYM</td></tr></table>`;
    const parsed = parseEdomexPage(html);
    expect(parsed.notices).toHaveLength(3);
    expect(parsed.notices[0].number).toBe("LPN/ISSEMYM/001/2026");
    expect(parsed.notices[0].url).toBe("https://portal.secogem.gob.mx/sites/default/files/a1.pdf");
    expect(() => parseEdomexPage("<h1>Access denied</h1>")).toThrow();
  });
});
