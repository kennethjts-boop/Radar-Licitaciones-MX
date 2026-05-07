import { enrichProcurement } from "../enrich-procurement.job";
import type { EnrichmentInput } from "../enrich-procurement.job";

// Mock D2, D3, and Telegram alerts
jest.mock("../../collectors/comprasmx-detail/index");
jest.mock("../../services/document-downloader");
jest.mock("../../alerts/telegram.alerts");

import { collectComprasMxDetail } from "../../collectors/comprasmx-detail/index";
import { downloadDocuments } from "../../services/document-downloader";
import { sendTelegramMessage } from "../../alerts/telegram.alerts";

const mockedCollect = collectComprasMxDetail as jest.MockedFunction<typeof collectComprasMxDetail>;
const mockedDownload = downloadDocuments as jest.MockedFunction<typeof downloadDocuments>;
const mockedSend = sendTelegramMessage as jest.MockedFunction<typeof sendTelegramMessage>;

const baseInput: EnrichmentInput = {
  procurementId: "proc-001",
  procedureNumber: "CAPUFE-2026-001",
  expedienteId: "EXP-001",
  sourceUrl: "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/detalle/uuid/procedimiento",
  title: "Mantenimiento de casetas",
  dependency: "CAPUFE",
  scope: "NATIONAL_CAPUFE_DESIERTA",
  radarKey: "capufe-oportunidades",
};

function makeCollectorResult(docs: { title: string; fileUrl: string }[]) {
  return {
    procedureNumber: "CAPUFE-2026-001",
    expedienteId: "EXP-001",
    source: "ComprasMX" as const,
    expedienteUrl: baseInput.sourceUrl!,
    scope: "NATIONAL_CAPUFE_DESIERTA",
    documents: docs.map((d) => ({
      documentTitle: d.title,
      fileName: d.fileUrl.split("/").pop() ?? null,
      fileUrl: d.fileUrl,
      fileType: "pdf" as const,
      source: "ComprasMX",
      discoveredAt: "2026-05-07T00:00:00Z",
      documentHint: "convocatoria" as const,
      isDownloadable: true,
    })),
    rawMetadata: {},
    collectorStatus: docs.length > 0 ? ("ok" as const) : ("no_documents" as const),
    errors: [],
  };
}

function makeDownloadResults(urls: string[], statuses: ("ok" | "failed")[]) {
  return urls.map((url, i) => ({
    fileUrl: url,
    fileName: url.split("/").pop() ?? "file.pdf",
    fileType: "pdf",
    sha256Hash: statuses[i] === "ok" ? "abc123" : null,
    downloadStatus: statuses[i] as "ok" | "failed",
    sizeBytes: statuses[i] === "ok" ? 1024 : null,
    localPath: statuses[i] === "ok" ? "/tmp/radar-docs/abc123.pdf" : null,
    errorMessage: statuses[i] === "ok" ? null : "Timeout",
    downloadedAt: "2026-05-07T00:00:00Z",
  }));
}

describe("enrichProcurement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSend.mockResolvedValue(12345);
  });

  it("sourceUrl null → skipped_no_documents, sin llamar a collector", async () => {
    const result = await enrichProcurement({ ...baseInput, sourceUrl: null });

    expect(result.status).toBe("skipped_no_documents");
    expect(result.documentsFound).toBe(0);
    expect(result.documentsDownloaded).toBe(0);
    expect(mockedCollect).not.toHaveBeenCalled();
  });

  it("collector devuelve 0 documentos → skipped_no_documents", async () => {
    mockedCollect.mockResolvedValue(makeCollectorResult([]));

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("skipped_no_documents");
    expect(result.documentsFound).toBe(0);
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it("todos los documentos descargan OK → success", async () => {
    const url = "https://example.com/bases.pdf";
    mockedCollect.mockResolvedValue(makeCollectorResult([{ title: "Bases", fileUrl: url }]));
    mockedDownload.mockResolvedValue(makeDownloadResults([url], ["ok"]));

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("success");
    expect(result.documentsFound).toBe(1);
    expect(result.documentsDownloaded).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("algunas descargas fallan → partial_success", async () => {
    const urls = ["https://example.com/a.pdf", "https://example.com/b.pdf"];
    mockedCollect.mockResolvedValue(
      makeCollectorResult([
        { title: "Bases", fileUrl: urls[0] },
        { title: "Anexo", fileUrl: urls[1] },
      ]),
    );
    mockedDownload.mockResolvedValue(makeDownloadResults(urls, ["ok", "failed"]));

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("partial_success");
    expect(result.documentsFound).toBe(2);
    expect(result.documentsDownloaded).toBe(1);
  });

  it("todos los documentos fallan → failed", async () => {
    const url = "https://example.com/bases.pdf";
    mockedCollect.mockResolvedValue(makeCollectorResult([{ title: "Bases", fileUrl: url }]));
    mockedDownload.mockResolvedValue(makeDownloadResults([url], ["failed"]));

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("failed");
    expect(result.documentsFound).toBe(1);
    expect(result.documentsDownloaded).toBe(0);
  });

  it("collector lanza excepción → failed sin re-throw", async () => {
    mockedCollect.mockRejectedValue(new Error("Playwright crashed"));

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("failed");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Playwright crashed");
  });
});
