import axios from "axios";
import * as fs from "fs";
import { downloadDocument, downloadDocuments } from "../document-downloader";
import type { DocumentLink } from "../../collectors/comprasmx-detail/index";

jest.mock("axios");
jest.mock("fs");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

function makeDocLink(overrides: Partial<DocumentLink> = {}): DocumentLink {
  return {
    documentTitle: "Bases del procedimiento",
    fileName: "bases.pdf",
    fileUrl: "https://example.com/bases.pdf",
    fileType: "pdf",
    source: "ComprasMX",
    discoveredAt: "2026-05-07T00:00:00.000Z",
    documentHint: "convocatoria",
    isDownloadable: true,
    ...overrides,
  };
}

describe("downloadDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockImplementation(() => undefined as unknown as string);
    mockedFs.writeFileSync.mockImplementation(() => undefined);
  });

  it("descarga PDF exitosamente → ok", async () => {
    const content = Buffer.from("PDF content here");
    mockedAxios.head.mockResolvedValue({ headers: {}, status: 200 });
    mockedAxios.get.mockResolvedValue({
      data: content,
      headers: { "content-length": String(content.length) },
      status: 200,
    });

    const result = await downloadDocument(makeDocLink());

    expect(result.downloadStatus).toBe("ok");
    expect(result.sha256Hash).toBeTruthy();
    expect(result.sizeBytes).toBe(content.length);
    expect(result.localPath).toContain("/tmp/radar-docs/");
  });

  it("Content-Length supera 20MB → too_large", async () => {
    mockedAxios.head.mockResolvedValue({
      headers: { "content-length": String(21 * 1024 * 1024) },
      status: 200,
    });

    const result = await downloadDocument(makeDocLink());

    expect(result.downloadStatus).toBe("too_large");
    expect(result.localPath).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("sha256 ya existe en disco → skipped_duplicate", async () => {
    const content = Buffer.from("PDF content here");
    mockedAxios.head.mockResolvedValue({ headers: {}, status: 200 });
    mockedAxios.get.mockResolvedValue({
      data: content,
      headers: {},
      status: 200,
    });
    mockedFs.existsSync.mockReturnValue(true);

    const result = await downloadDocument(makeDocLink());

    expect(result.downloadStatus).toBe("skipped_duplicate");
    expect(result.sha256Hash).toBeTruthy();
    expect(result.localPath).toContain("/tmp/radar-docs/");
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("axios GET lanza error → failed", async () => {
    mockedAxios.head.mockRejectedValue(new Error("head fail"));
    mockedAxios.get.mockRejectedValue(new Error("Network error"));

    const result = await downloadDocument(makeDocLink({ fileType: "pdf" }));

    expect(result.downloadStatus).toBe("failed");
    expect(result.errorMessage).toContain("Network error");
    expect(result.localPath).toBeNull();
  });

  it("fileType 'other' → failed (tipo no soportado)", async () => {
    const result = await downloadDocument(
      makeDocLink({ fileType: "other", fileName: "doc.html" }),
    );

    expect(result.downloadStatus).toBe("failed");
    expect(result.errorMessage).toContain("tipo no soportado");
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

describe("downloadDocuments (batch)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockImplementation(() => undefined as unknown as string);
    mockedFs.writeFileSync.mockImplementation(() => undefined);
  });

  it("batch con uno ok y uno failed → retorna los dos resultados", async () => {
    const content = Buffer.from("data");
    mockedAxios.head
      .mockResolvedValueOnce({ headers: {}, status: 200 })
      .mockRejectedValueOnce(new Error("head fail"));
    mockedAxios.get
      .mockResolvedValueOnce({ data: content, headers: { "content-length": "4" }, status: 200 })
      .mockRejectedValueOnce(new Error("Timeout"));

    const results = await downloadDocuments([
      makeDocLink({ fileUrl: "https://example.com/a.pdf" }),
      makeDocLink({ fileUrl: "https://example.com/b.pdf" }),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].downloadStatus).toBe("ok");
    expect(results[1].downloadStatus).toBe("failed");
  });
});
