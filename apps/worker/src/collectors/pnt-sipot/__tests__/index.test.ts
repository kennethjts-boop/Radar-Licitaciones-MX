import axios from "axios";
import { fetchPntSipot } from "../index";

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

const baseQuery = {
  keywords: ["mantenimiento", "vial"],
  scope: "MORELOS_ONLY" as const,
};

function makeSipotResponse(records: Record<string, unknown>[]) {
  return {
    data: {
      payload: {
        datosSolr: records,
      },
    },
  };
}

describe("fetchPntSipot", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna contratos de Morelos", async () => {
    mockAxios.post.mockResolvedValue(makeSipotResponse([{
      objetoContrato: "Mantenimiento de carretera en Cuernavaca Morelos",
      nombreContratista: "Empresa ABC",
      rfcContratista: "ABC010101XX1",
      montoContrato: "$2,500,000.00",
      montoMinimo: "1000000",
      montoMaximo: "3000000",
      fechaContrato: "2023-03-10",
      fechaInicio: "2023-04-01",
      fechaTermino: "2023-12-31",
      nombreSujetoObligado: "SCT",
      numeroContrato: "SIPOT-001",
      numeroProcedimiento: "LA-001-2023",
      ejercicio: "2023",
    }]));

    const result = await fetchPntSipot(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].title).toContain("Morelos");
    expect(result.contracts[0]).toMatchObject({
      supplier: "Empresa ABC",
      supplierRfc: "ABC010101XX1",
      awardedAmount: 2500000,
      amountMin: 1000000,
      amountMax: 3000000,
      contractNumber: "SIPOT-001",
      procurementProcedureNumber: "LA-001-2023",
      fiscalYear: 2023,
    });
    expect(result.contracts[0].evidenceText).toContain("monto 2500000");
  });

  it("filtra contratos fuera de scope", async () => {
    mockAxios.post.mockResolvedValue(makeSipotResponse([{
      objetoContrato: "Obra en Monterrey Nuevo León sin relación",
      nombreContratista: "Empresa XYZ",
      montoContrato: "1000000",
      fechaContrato: "2023-01-01",
      nombreSujetoObligado: "IMSS",
    }]));

    const result = await fetchPntSipot(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(0);
  });

  it("maneja typo del servidor: paylod.datosSolr", async () => {
    mockAxios.post.mockResolvedValue({
      data: { paylod: { datosSolr: [{ objetoContrato: "Mantenimiento en Morelos", montoContrato: "500000" }] } },
    });

    const result = await fetchPntSipot(baseQuery);
    expect(result.status).toBe("ok");
  });

  it("incluye dependency en el payload y filtra por rango de año", async () => {
    mockAxios.post.mockResolvedValue(makeSipotResponse([
      {
        objetoContrato: "Mantenimiento en Cuernavaca Morelos",
        montoContrato: "500000",
        ejercicio: "2019",
      },
      {
        objetoContrato: "Mantenimiento en Cuernavaca Morelos",
        montoContrato: "750000",
        ejercicio: "2024",
      },
    ]));

    const result = await fetchPntSipot({
      ...baseQuery,
      dependency: "CAPUFE",
      yearFrom: 2020,
      yearTo: 2026,
    });

    expect(mockAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ contenido: "mantenimiento vial CAPUFE" }),
      expect.any(Object),
    );
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].awardedAmount).toBe(750000);
  });

  it("retorna unavailable cuando axios lanza", async () => {
    mockAxios.post.mockRejectedValue(new Error("Network timeout"));

    const result = await fetchPntSipot(baseQuery);

    expect(result.status).toBe("unavailable");
    expect(result.contracts).toHaveLength(0);
  });

  it("no hace throw en ningún caso", async () => {
    mockAxios.post.mockRejectedValue(new Error("fatal"));
    await expect(fetchPntSipot(baseQuery)).resolves.toBeDefined();
  });
});
