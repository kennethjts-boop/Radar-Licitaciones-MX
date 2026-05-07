import axios from "axios";
import { fetchDofSidof } from "../index";

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

const baseQuery = {
  keywords: ["mantenimiento", "Morelos"],
  scope: "MORELOS_ONLY" as const,
};

// Minimal HTML that a real SIDOF response might look like
const MORELOS_HTML = `
<html><body>
<div class="nota-item">
  <h3 class="nota-titulo"><a href="/nota/12345">Licitación mantenimiento vial Morelos</a></h3>
  <span class="nota-dependencia">SICT</span>
  <span class="nota-fecha">07/05/2026</span>
</div>
</body></html>
`;

const JALISCO_HTML = `
<html><body>
<div class="nota-item">
  <h3 class="nota-titulo"><a href="/nota/99999">Concurso obra Guadalajara Jalisco</a></h3>
  <span class="nota-dependencia">IMSS</span>
  <span class="nota-fecha">07/05/2026</span>
</div>
</body></html>
`;

const EMPTY_HTML = `<html><body><p>No se encontraron resultados.</p></body></html>`;

describe("fetchDofSidof", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna publicaciones de Morelos", async () => {
    mockAxios.get.mockResolvedValue({ data: MORELOS_HTML });

    const result = await fetchDofSidof(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.publications).toHaveLength(1);
    expect(result.publications[0].title).toContain("Morelos");
  });

  it("filtra publicaciones fuera de scope", async () => {
    mockAxios.get.mockResolvedValue({ data: JALISCO_HTML });

    const result = await fetchDofSidof(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.publications).toHaveLength(0);
  });

  it("retorna ok vacío si HTML no tiene resultados", async () => {
    mockAxios.get.mockResolvedValue({ data: EMPTY_HTML });

    const result = await fetchDofSidof(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.publications).toHaveLength(0);
  });

  it("retorna unavailable cuando axios lanza", async () => {
    mockAxios.get.mockRejectedValue(new Error("Connection refused"));

    const result = await fetchDofSidof(baseQuery);

    expect(result.status).toBe("unavailable");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("no hace throw en ningún caso", async () => {
    mockAxios.get.mockRejectedValue(new Error("fatal"));
    await expect(fetchDofSidof(baseQuery)).resolves.toBeDefined();
  });
});
