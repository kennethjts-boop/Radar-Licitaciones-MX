import { parseXlsx } from "../xlsx-parser";
import ExcelJS from "exceljs";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

describe("parseXlsx", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "xlsx-parser-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeWorkbook(
    fileName: string,
    sheets: Array<{ name: string; rows: string[][] }>,
  ): Promise<string> {
    const filePath = path.join(tmpDir, fileName);
    const workbook = new ExcelJS.Workbook();

    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(sheet.name);
      worksheet.addRows(sheet.rows);
    }

    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  it("parseStatus=ok con una hoja normal", async () => {
    const filePath = await writeWorkbook("test.xlsx", [
      { name: "Hoja1", rows: [["Col1", "Col2"], ["Val1", "Val2"]] },
    ]);
    const result = await parseXlsx(filePath);
    expect(result.parseStatus).toBe("ok");
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].name).toBe("Hoja1");
    expect(result.isCatalogConceptos).toBe(false);
  });

  it("detecta catálogo de conceptos por encabezados", async () => {
    const filePath = await writeWorkbook("catalogo.xlsx", [
      {
        name: "Catalogo",
        rows: [["Partida", "Descripcion", "Cantidad", "Precio", "Importe"], ["1", "Tuberia", "100", "500", "50000"]],
      },
    ]);
    const result = await parseXlsx(filePath);
    expect(result.isCatalogConceptos).toBe(true);
    expect(result.sheets[0].hasCatalogColumns).toBe(true);
  });

  it("parseStatus=empty cuando workbook sin hojas", async () => {
    const filePath = path.join(tmpDir, "empty.xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.writeFile(filePath);
    const result = await parseXlsx(filePath);
    expect(result.parseStatus).toBe("empty");
    expect(result.sheets).toHaveLength(0);
  });

  it("parseStatus=error cuando ExcelJS no puede leer archivo", async () => {
    const filePath = path.join(tmpDir, "bad.xlsx");
    await fs.writeFile(filePath, "archivo corrupto");
    const result = await parseXlsx(filePath);
    expect(result.parseStatus).toBe("error");
    expect(result.errors[0]).toBeTruthy();
  });

  it("no hace throw en ningún caso", async () => {
    await expect(parseXlsx(path.join(tmpDir, "missing.xlsx"))).resolves.toBeDefined();
  });
});
