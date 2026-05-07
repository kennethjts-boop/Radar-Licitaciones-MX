import { parseDocx } from "../docx-parser";
import mammoth from "mammoth";

jest.mock("mammoth");
const mockMammoth = mammoth as jest.Mocked<typeof mammoth>;

describe("parseDocx", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parseStatus=ok con texto extraído", async () => {
    (mockMammoth.extractRawText as jest.Mock).mockResolvedValue({ value: "Bases de licitación para mantenimiento vial.", messages: [] });
    const result = await parseDocx("/tmp/test.docx");
    expect(result.parseStatus).toBe("ok");
    expect(result.text).toBe("Bases de licitación para mantenimiento vial.");
    expect(result.errors).toHaveLength(0);
  });

  it("parseStatus=empty cuando mammoth devuelve texto vacío", async () => {
    (mockMammoth.extractRawText as jest.Mock).mockResolvedValue({ value: "   ", messages: [] });
    const result = await parseDocx("/tmp/test.docx");
    expect(result.parseStatus).toBe("empty");
    expect(result.text).toBe("");
  });

  it("parseStatus=error cuando mammoth lanza", async () => {
    (mockMammoth.extractRawText as jest.Mock).mockRejectedValue(new Error("DOCX inválido"));
    const result = await parseDocx("/tmp/test.docx");
    expect(result.parseStatus).toBe("error");
    expect(result.errors[0]).toContain("DOCX inválido");
  });

  it("no hace throw en ningún caso", async () => {
    (mockMammoth.extractRawText as jest.Mock).mockRejectedValue(new Error("fatal"));
    await expect(parseDocx("/tmp/test.docx")).resolves.toBeDefined();
  });
});
