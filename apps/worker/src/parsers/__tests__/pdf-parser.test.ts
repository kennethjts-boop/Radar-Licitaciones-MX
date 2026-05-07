import { parsePdf } from "../pdf-parser";
import * as pdfUtil from "../../utils/pdf.util";

jest.mock("../../utils/pdf.util");
const mockExtract = pdfUtil.extractTextFromPdf as jest.MockedFunction<typeof pdfUtil.extractTextFromPdf>;

describe("parsePdf", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parseStatus=ok cuando texto >= 50 chars", async () => {
    mockExtract.mockResolvedValue("A".repeat(100));
    const result = await parsePdf("/tmp/test.pdf");
    expect(result.parseStatus).toBe("ok");
    expect(result.text).toBe("A".repeat(100));
    expect(result.errors).toHaveLength(0);
  });

  it("parseStatus=empty cuando texto vacío", async () => {
    mockExtract.mockResolvedValue("");
    const result = await parsePdf("/tmp/test.pdf");
    expect(result.parseStatus).toBe("empty");
    expect(result.text).toBe("");
  });

  it("parseStatus=needs_ocr cuando texto < 50 chars", async () => {
    mockExtract.mockResolvedValue("poco texto");
    const result = await parsePdf("/tmp/test.pdf");
    expect(result.parseStatus).toBe("needs_ocr");
  });

  it("parseStatus=error cuando extractTextFromPdf lanza", async () => {
    mockExtract.mockRejectedValue(new Error("PDF corrupto"));
    const result = await parsePdf("/tmp/test.pdf");
    expect(result.parseStatus).toBe("error");
    expect(result.errors[0]).toContain("PDF corrupto");
  });

  it("no hace throw en ningún caso", async () => {
    mockExtract.mockRejectedValue(new Error("fatal"));
    await expect(parsePdf("/tmp/test.pdf")).resolves.toBeDefined();
  });
});
