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
      montoContrato: "2500000",
      fechaContrato: "2023-03-10",
      nombreSujetoObligado: "SCT",
      numeroContrato: "SIPOT-001",
    }]));

    const result = await fetchPntSipot(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].title).toContain("Morelos");
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
