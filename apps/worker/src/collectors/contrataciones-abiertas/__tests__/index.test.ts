import axios from "axios";
import { fetchContratacionesAbiertas } from "../index";

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

const baseQuery = {
  keywords: ["mantenimiento", "carretera"],
  scope: "MORELOS_ONLY" as const,
};

function makeOcdsResponse(records: Record<string, unknown>[]) {
  return { data: { records } };
}

function makeOcdsRecord(title: string, state: string, amount: number) {
  return {
    compiledRelease: {
      ocid: "ocds-mx-001",
      tender: {
        id: "LPN-2023-001",
        title,
        datePublished: "2023-06-01",
        description: `Obra en ${state}`,
      },
      buyer: { name: "SCT" },
      awards: [{ suppliers: [{ name: "Empresa SA" }], value: { amount, currency: "MXN" } }],
    },
  };
}

describe("fetchContratacionesAbiertas", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna contratos de Morelos", async () => {
    mockAxios.get.mockResolvedValue(
      makeOcdsResponse([makeOcdsRecord("Mantenimiento en Cuernavaca Morelos", "Morelos", 1800000)])
    );

    const result = await fetchContratacionesAbiertas(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].awardedAmount).toBe(1800000);
  });

  it("filtra contratos fuera de scope", async () => {
    mockAxios.get.mockResolvedValue(
      makeOcdsResponse([makeOcdsRecord("Obra en Sonora sin relación", "Sonora", 500000)])
    );

    const result = await fetchContratacionesAbiertas(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(0);
  });

  it("retorna unavailable cuando axios lanza", async () => {
    mockAxios.get.mockRejectedValue(new Error("503 Service Unavailable"));

    const result = await fetchContratacionesAbiertas(baseQuery);

    expect(result.status).toBe("unavailable");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("retorna ok con vacío cuando no hay records", async () => {
    mockAxios.get.mockResolvedValue(makeOcdsResponse([]));

    const result = await fetchContratacionesAbiertas(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(0);
  });

  it("no hace throw en ningún caso", async () => {
    mockAxios.get.mockRejectedValue(new Error("fatal"));
    await expect(fetchContratacionesAbiertas(baseQuery)).resolves.toBeDefined();
  });
});
