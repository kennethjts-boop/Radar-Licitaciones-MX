import {
  classifyComprasMxBrowserOutcome,
  parseComprasMxProcedimientosResponse,
  apiRegistroToRawInput,
} from "../comprasmx.navigator";

describe("ComprasMX browser fallback response handling", () => {
  it("clasifica como falla de extracción cuando el sitio carga sin respuesta ni filas", () => {
    expect(
      classifyComprasMxBrowserOutcome({
        siteAccessible: true,
        validResponseCaptured: false,
        rowsExtracted: 0,
      }),
    ).toBe("site_accessible_extraction_failed");
  });

  it("clasifica una respuesta válida sin registros como empty_result", () => {
    const parsed = parseComprasMxProcedimientosResponse(
      JSON.stringify({
        success: true,
        data: [{
          registros: [],
          paginacion: [{
            pagina_actual: 1,
            total_registros: 0,
            registro_inicial: 0,
            registro_final: 0,
          }],
        }],
      }),
    );

    expect(parsed.registros).toEqual([]);
    expect(
      classifyComprasMxBrowserOutcome({
        siteAccessible: true,
        validResponseCaptured: true,
        rowsExtracted: parsed.registros.length,
      }),
    ).toBe("empty_result");
  });

  it("clasifica una respuesta con filas como success y conserva los registros", () => {
    const parsed = parseComprasMxProcedimientosResponse(
      JSON.stringify({
        success: true,
        data: [{
          registros: [{
            numero_procedimiento: "LA-09-J0U-009J0U012-N-7-2026",
            nombre_procedimiento: "Mantenimiento preventivo",
            siglas: "CAPUFE",
            estatus_alterno: "VIGENTE",
          }],
          paginacion: [{
            pagina_actual: 1,
            total_registros: 1,
            registro_inicial: 1,
            registro_final: 1,
          }],
        }],
      }),
    );

    expect(parsed.registros).toHaveLength(1);
    expect(parsed.registros[0].numero_procedimiento).toBe(
      "LA-09-J0U-009J0U012-N-7-2026",
    );
    expect(
      classifyComprasMxBrowserOutcome({
        siteAccessible: true,
        validResponseCaptured: true,
        rowsExtracted: parsed.registros.length,
      }),
    ).toBe("success");
  });

  it("reserva source_unavailable para fallas reales de acceso", () => {
    expect(
      classifyComprasMxBrowserOutcome({
        siteAccessible: false,
        validResponseCaptured: false,
        rowsExtracted: 0,
      }),
    ).toBe("source_unavailable");
  });

  it("preserva unidad compradora y entidad federativa estructuradas", () => {
    const raw = apiRegistroToRawInput({
      numero_procedimiento: "LA-50-GYR-050GYR085-N-33-2026",
      nombre_procedimiento: "Servicio Centro Vacacional",
      uuid_procedimiento: "uuid-oaxtepec",
      siglas: "IMSS",
      fecha_publicacion: "13/08/2026 00:00",
      unidad_compradora: "050GYR085 - CENTRO VACACIONAL IMSS OAXTEPEC",
      entidad_federativa_contratacion: "MORELOS",
    } as never);
    expect(raw.buyingUnit).toBe("050GYR085 - CENTRO VACACIONAL IMSS OAXTEPEC");
    expect(raw.state).toBe("MORELOS");
    expect(raw.publicationDate).toBe("13/08/2026 00:00");
  });
});
