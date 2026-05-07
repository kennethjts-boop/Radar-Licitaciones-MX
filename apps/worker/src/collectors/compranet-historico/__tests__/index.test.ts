import axios from "axios";
import { fetchCompranetHistorico } from "../index";

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

const baseQuery = {
  keywords: ["mantenimiento", "vial"],
  scope: "MORELOS_ONLY" as const,
};

function makeCkanResponse(records: Record<string, string>[]) {
  return {
    data: {
      result: {
        records,
        total: records.length,
      },
    },
  };
}

describe("fetchCompranetHistorico", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna contratos cuando API responde con resultados de Morelos", async () => {
    mockAxios.get.mockResolvedValue(makeCkanResponse([{
      NUMERO_PROCEDIMIENTO: "LPN-001-2023",
      TITULO_CONTRATO: "Mantenimiento vial en Morelos",
      DEPENDENCIA: "SCT",
      PROVEEDOR_CONTRATISTA: "Constructora XYZ",
      IMPORTE_CONTRATO: "1500000",
      MONEDA: "MXN",
      ANUNCIO: "2023-05-15",
      ENTIDAD_FEDERATIVA: "Morelos",
      TIPO_PROCEDIMIENTO: "Licitación Pública",
    }]));

    const result = await fetchCompranetHistorico(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].state).toBe("Morelos");
    expect(result.contracts[0].awardedAmount).toBe(1500000);
  });

  it("filtra contratos fuera de scope (estado Jalisco)", async () => {
    mockAxios.get.mockResolvedValue(makeCkanResponse([{
      NUMERO_PROCEDIMIENTO: "LPN-002-2023",
      TITULO_CONTRATO: "Obra en Guadalajara",
      DEPENDENCIA: "SCT",
      IMPORTE_CONTRATO: "900000",
      ENTIDAD_FEDERATIVA: "Jalisco",
    }]));

    const result = await fetchCompranetHistorico(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(0);
  });

  it("retorna unavailable cuando axios lanza error", async () => {
    mockAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchCompranetHistorico(baseQuery);

    expect(result.status).toBe("unavailable");
    expect(result.contracts).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("retorna ok con array vacío cuando CKAN no devuelve records", async () => {
    mockAxios.get.mockResolvedValue(makeCkanResponse([]));

    const result = await fetchCompranetHistorico(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(0);
    expect(result.totalFound).toBe(0);
  });

  it("no hace throw en ningún caso", async () => {
    mockAxios.get.mockRejectedValue(new Error("fatal network error"));
    await expect(fetchCompranetHistorico(baseQuery)).resolves.toBeDefined();
  });
});
