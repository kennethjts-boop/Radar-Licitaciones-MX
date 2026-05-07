import { parseZip } from "../zip-parser";
import AdmZip from "adm-zip";

jest.mock("adm-zip");
const MockAdmZip = AdmZip as jest.MockedClass<typeof AdmZip>;

function makeEntry(name: string, size: number, data: Buffer, isDirectory = false) {
  return {
    entryName: name,
    isDirectory,
    header: { size },
    getData: () => data,
  };
}

describe("parseZip", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parseStatus=empty cuando zip sin archivos parseables", async () => {
    MockAdmZip.prototype.getEntries = jest.fn().mockReturnValue([
      makeEntry("readme.txt", 10, Buffer.from("hello"), false),
    ]);
    const result = await parseZip("/tmp/test.zip");
    expect(result.parseStatus).toBe("empty");
    expect(result.files).toHaveLength(0);
  });

  it("respeta límite de 50 archivos", async () => {
    const entries = Array.from({ length: 55 }, (_, i) =>
      makeEntry(`file${i}.txt`, 10, Buffer.from("x"), false)
    );
    MockAdmZip.prototype.getEntries = jest.fn().mockReturnValue(entries);
    const result = await parseZip("/tmp/big.zip");
    expect(result.errors.some((e) => e.includes("50"))).toBe(true);
  });

  it("respeta límite de 100 MB total", async () => {
    const entries = [
      makeEntry("a.pdf", 60 * 1024 * 1024, Buffer.from("a"), false),
      makeEntry("b.pdf", 60 * 1024 * 1024, Buffer.from("b"), false),
    ];
    MockAdmZip.prototype.getEntries = jest.fn().mockReturnValue(entries);
    const result = await parseZip("/tmp/huge.zip");
    expect(result.errors.some((e) => e.includes("100"))).toBe(true);
  });

  it("parseStatus=error cuando AdmZip lanza al construirse", async () => {
    MockAdmZip.mockImplementationOnce(() => { throw new Error("zip inválido"); });
    const result = await parseZip("/tmp/bad.zip");
    expect(result.parseStatus).toBe("error");
    expect(result.errors[0]).toContain("zip inválido");
  });

  it("no hace throw en ningún caso", async () => {
    MockAdmZip.mockImplementationOnce(() => { throw new Error("fatal"); });
    await expect(parseZip("/tmp/test.zip")).resolves.toBeDefined();
  });
});
