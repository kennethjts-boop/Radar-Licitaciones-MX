import { parseXlsx } from "../xlsx-parser";
import * as XLSX from "xlsx";

jest.mock("xlsx");
const mockXLSX = XLSX as jest.Mocked<typeof XLSX>;

describe("parseXlsx", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parseStatus=ok con una hoja normal", async () => {
    const wb = { SheetNames: ["Hoja1"], Sheets: { Hoja1: {} as XLSX.WorkSheet } };
    (mockXLSX.readFile as jest.Mock).mockReturnValue(wb);
    (mockXLSX.utils.sheet_to_csv as jest.Mock).mockReturnValue("Col1,Col2\nVal1,Val2");
    const result = await parseXlsx("/tmp/test.xlsx");
    expect(result.parseStatus).toBe("ok");
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].name).toBe("Hoja1");
    expect(result.isCatalogConceptos).toBe(false);
  });

  it("detecta catálogo de conceptos por encabezados", async () => {
    const wb = { SheetNames: ["Catálogo"], Sheets: { "Catálogo": {} as XLSX.WorkSheet } };
    (mockXLSX.readFile as jest.Mock).mockReturnValue(wb);
    (mockXLSX.utils.sheet_to_csv as jest.Mock).mockReturnValue("Partida,Descripcion,Cantidad,Precio,Importe\n1,Tubería,100,500,50000");
    const result = await parseXlsx("/tmp/catalogo.xlsx");
    expect(result.isCatalogConceptos).toBe(true);
    expect(result.sheets[0].hasCatalogColumns).toBe(true);
  });

  it("parseStatus=empty cuando workbook sin hojas", async () => {
    (mockXLSX.readFile as jest.Mock).mockReturnValue({ SheetNames: [], Sheets: {} } as XLSX.WorkBook);
    const result = await parseXlsx("/tmp/empty.xlsx");
    expect(result.parseStatus).toBe("empty");
    expect(result.sheets).toHaveLength(0);
  });

  it("parseStatus=error cuando XLSX.readFile lanza", async () => {
    (mockXLSX.readFile as jest.Mock).mockImplementation(() => { throw new Error("archivo corrupto"); });
    const result = await parseXlsx("/tmp/bad.xlsx");
    expect(result.parseStatus).toBe("error");
    expect(result.errors[0]).toContain("archivo corrupto");
  });

  it("no hace throw en ningún caso", async () => {
    (mockXLSX.readFile as jest.Mock).mockImplementation(() => { throw new Error("fatal"); });
    await expect(parseXlsx("/tmp/test.xlsx")).resolves.toBeDefined();
  });
});
