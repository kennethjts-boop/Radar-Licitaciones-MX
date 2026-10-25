import { createHash } from "crypto";
import { parseEdomexPage, normalizeConvocatoria, explicitContractAmount, splitProcedureNumbers } from "../policy";
import { formatEdomexTelegramAlert } from "../message";
import { classifyEdomexProcurement, EDOMEX_FOCUS_KEYS, isPublishedOnOrAfterEdomexCutoff } from "../../../radars/edomex-focus.matcher";
import { evaluateProcurementAgainstRadar } from "../../../matchers/matcher";
import { getRadarByKey, getActiveRadars } from "../../../radars";
import type { NormalizedProcurement } from "../../../types/procurement";

const PDF = "https://portal.secogem.gob.mx/a.pdf";

function secogem(number: string, description: string, dependency = "SECRETARÍA"): NormalizedProcurement {
  const [item] = normalizeConvocatoria({
    rowId: "r", page: "https://portal.secogem.gob.mx/convocatorias-obra-publica", numberCell: number,
    numbers: [number], url: PDF, dependency, description, headers: [], cells: [],
    officialPublicationDate: null, registrationDeadline: null, openingDate: null,
  }, { firstDetectedAt: "2026-10-25T18:00:00.000Z", historical: false });
  return item;
}

function comprasmx(raw: Record<string, unknown>, title: string): NormalizedProcurement {
  return { ...secogem("X-1", title), source: "comprasmx", dependencyName: String(raw.siglas ?? ""),
    buyingUnit: String(raw.unidad_compradora ?? ""), amount: null, rawJson: raw };
}

describe("focos Edomex", () => {
  it("activa 15 radares: once focos de octubre y cuatro Edomex", () => {
    expect(getActiveRadars()).toHaveLength(15);
    expect(getActiveRadars().filter((r) => r.key.startsWith("edomex_"))).toHaveLength(4);
  });

  it("ISSEMyM acepta cualquier giro y monto", () => {
    const d = classifyEdomexProcurement(secogem("LPN/ISSEMYM/046/2026", "Papelería, monto estimado: $45,000", "ISSEMYM"));
    expect(d?.key).toBe(EDOMEX_FOCUS_KEYS.issemym);
  });

  it("carreteras exige superar 100 MDP; sin monto queda pendiente sólo con alcance regional", () => {
    expect(classifyEdomexProcurement(secogem("JCEM-1", "Rehabilitación de carretera, monto estimado: $100,000,000"))).toBeNull();
    const above = classifyEdomexProcurement(secogem("JCEM-2", "Rehabilitación de carretera, monto estimado: 101 mdp"));
    expect(above).toMatchObject({ key: EDOMEX_FOCUS_KEYS.carreteras, amountStatus: "confirmed" });
    const pending = classifyEdomexProcurement(secogem("JCEM-10", "Rescate de vialidades de la residencia regional mediante bacheo asfáltico"));
    expect(pending).toMatchObject({ key: EDOMEX_FOCUS_KEYS.carreteras, amountStatus: "pending" });
    expect(classifyEdomexProcurement(secogem("MUN-10", "Pavimentación de calle Palma de 139 metros"))).toBeNull();
  });

  it("SITRAMyTEM: mantenimiento acotado sí; Mexibús/Mexicable integrales y concesiones no", () => {
    expect(classifyEdomexProcurement(secogem("SITRAMYTEM-26", "Mantenimiento de semáforos de los sistemas Mexibús", "SITRAMYTEM"))?.key)
      .toBe(EDOMEX_FOCUS_KEYS.sitramytem);
    expect(classifyEdomexProcurement(secogem("SITRAMYTEM-06", "Línea 7 del Mexibús, construcción integral", "SITRAMYTEM"))).toBeNull();
    expect(classifyEdomexProcurement(secogem("SITRAMYTEM-07", "Mexicable línea 3 llave en mano", "SITRAMYTEM"))).toBeNull();
    expect(classifyEdomexProcurement(secogem("SITRAMYTEM-08", "Concesión de mantenimiento de estaciones", "SITRAMYTEM"))).toBeNull();
  });

  it("otros giros: 20 MDP explícitos o alcance amplio como candidata pendiente", () => {
    expect(classifyEdomexProcurement(secogem("OM-01", "Adquisición de una silla"))).toBeNull();
    expect(classifyEdomexProcurement(secogem("OM-03", "Servicio integral de limpieza, monto estimado $19,000,000"))).toBeNull();
    expect(classifyEdomexProcurement(secogem("OM-04", "Servicio integral de limpieza, monto estimado $20,000,000")))
      .toMatchObject({ key: EDOMEX_FOCUS_KEYS.oportunidades, amountStatus: "confirmed" });
    expect(classifyEdomexProcurement(secogem("OM-02", "Servicio integral de limpieza estatal")))
      .toMatchObject({ key: EDOMEX_FOCUS_KEYS.oportunidades, amountStatus: "pending" });
  });

  it("ComprasMX: sólo UC estatales/municipales del Edomex, no federales ubicadas en el estado", () => {
    const local = comprasmx({ siglas: "OM", unidad_compradora: "915002994 - DIRECCIÓN GENERAL DE RECURSOS MATERIALES" },
      "Servicio integral de limpieza para dependencias estatales");
    expect(classifyEdomexProcurement(local)?.key).toBe(EDOMEX_FOCUS_KEYS.oportunidades);
    const municipal = comprasmx({ siglas: "074049", unidad_compradora: "815067908 - DIRECCIÓN DE OBRAS PÚBLICAS" },
      "Rehabilitación de la red carretera municipal km 12");
    expect(classifyEdomexProcurement(municipal)?.key).toBe(EDOMEX_FOCUS_KEYS.carreteras);
    const federal = comprasmx({ siglas: "IMSS", unidad_compradora: "050GYR015 - DELEGACIÓN MÉXICO ORIENTE" },
      "Servicio integral de limpieza");
    expect(classifyEdomexProcurement(federal)).toBeNull();
  });

  it("el matcher produce un match medio con monto pendiente y explicación explícita", () => {
    const radar = getRadarByKey(EDOMEX_FOCUS_KEYS.oportunidades)!;
    const match = evaluateProcurementAgainstRadar(secogem("OM-02", "Servicio integral de limpieza estatal"), radar, true);
    expect(match?.matchLevel).toBe("medium");
    expect(match?.explanation).toMatch(/pendiente de confirmar/);
  });

  it("corte de activación: no alerta publicaciones previas", () => {
    expect(isPublishedOnOrAfterEdomexCutoff(new Date("2026-10-20T12:00:00Z"))).toBe(false);
    expect(isPublishedOnOrAfterEdomexCutoff(new Date("2026-10-26T12:00:00Z"))).toBe(true);
    expect(isPublishedOnOrAfterEdomexCutoff(null)).toBe(true);
  });
});

describe("índice SECOGEM", () => {
  it("capital contable, bases o dos montos nunca se convierten en presupuesto", () => {
    expect(explicitContractAmount("Capital contable $350,000,000, costo de bases $10,000")).toBeNull();
    expect(explicitContractAmount("Monto estimado $200,000,000. Presupuesto autorizado $240,000,000")).toBeNull();
    expect(explicitContractAmount("Presupuesto base de obra: $150,000,000")).toBe(150_000_000);
  });

  it("lee el formato con ^, conserva la identidad de la línea base y rechaza PDFs externos", () => {
    const html = `<table>${[1, 2, 3].map((n) => `<tr><td>LPN/ISSEMYM/00${n}/2026^/sites/default/files/a${n}.pdf</td><td>ISSEMYM^<p>Adquisición de papelería</p></td></tr>`).join("")}<tr><td>BAD^https://evil.example/a.pdf</td><td>ISSEMYM</td></tr></table>`;
    const rows = parseEdomexPage(html);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ numbers: ["LPN/ISSEMYM/001/2026"], dependency: "ISSEMYM", description: "Adquisición de papelería" });
    const legacyId = createHash("sha256").update("LPN/ISSEMYM/001/2026|https://portal.secogem.gob.mx/sites/default/files/a1.pdf").digest("hex").slice(0, 24);
    expect(rows[0].rowId).toBe(legacyId);
    expect(() => parseEdomexPage("<h1>Access denied</h1>")).toThrow();
  });

  it("una convocatoria agrupada conserva cada procedimiento y no reparte el presupuesto", () => {
    expect(splitProcedureNumbers("LPN-001-2026, LPN-002-2026 y LPN-003-2026")).toEqual(["LPN-001-2026", "LPN-002-2026", "LPN-003-2026"]);
    const html = `<table><tr><th>Número</th><th>Descripción</th><th>Fecha de publicación</th><th>Fecha límite de inscripción</th></tr>` +
      [1, 2, 3].map((n) => `<tr><td>JCEM-00${n}-2026, JCEM-01${n}-2026^/f/c${n}.pdf</td><td>JCEM^Conservación de carreteras, presupuesto base de obra: $300,000,000</td><td>26/10/2026</td><td>30 de octubre de 2026</td></tr>`).join("") + "</table>";
    const [row] = parseEdomexPage(html);
    expect(row.officialPublicationDate).toBe("2026-10-26");
    expect(row.registrationDeadline).toBe("2026-10-30");
    const items = normalizeConvocatoria(row, { firstDetectedAt: "2026-10-26T10:00:00Z", historical: false });
    expect(items.map((i) => i.externalId)).toEqual(["secogem:JCEM-001-2026", "secogem:JCEM-011-2026"]);
    expect(items.every((i) => i.amount === null && i.rawJson.monto_estado === "convocatoria_agrupada")).toBe(true);
  });

  it("la tarjeta distingue publicación oficial y primera detección, y no afirma el umbral sin monto", () => {
    const item = secogem("JCEM-10", "Bacheo de la residencia regional");
    const text = formatEdomexTelegramAlert({
      alertType: "new_match", radarKey: EDOMEX_FOCUS_KEYS.carreteras, radarName: "x", matchLevel: "medium",
      matchScore: 1, opportunityScore: 0, documentScore: 0, procurement: item, matchedTerms: [], explanation: "",
      scoreReasons: ["amount_pending"], detectedAt: "2026-10-25T18:00:00.000Z", telegramMessage: "", hasHistory: false, historyCount: 0,
    } as never);
    expect(text).toMatch(/Publicación oficial: no consta/);
    expect(text).toMatch(/Primera detección del radar: 25\/10\/2026/);
    expect(text).toMatch(/falta confirmar que supere \$100 MDP/);
    expect(text).toMatch(/sólo cambios del PDF/);
  });
});
