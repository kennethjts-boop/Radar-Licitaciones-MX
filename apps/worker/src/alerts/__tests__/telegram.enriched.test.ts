import { formatEnrichedAlert } from "../telegram.alerts";
import type { EnrichedAlertData } from "../telegram.alerts";
import type { DocumentLink } from "../../collectors/comprasmx-detail/index";
import type { DownloadResult } from "../../services/document-downloader";

function makeDocLink(title: string): DocumentLink {
  return {
    documentTitle: title,
    fileName: `${title.toLowerCase().replace(/\s/g, "_")}.pdf`,
    fileUrl: `https://example.com/${title}.pdf`,
    fileType: "pdf",
    source: "ComprasMX",
    discoveredAt: "2026-05-07T00:00:00Z",
    documentHint: "convocatoria",
    isDownloadable: true,
  };
}

function makeDownloadResult(fileUrl: string, status: "ok" | "failed"): DownloadResult {
  return {
    fileUrl,
    fileName: fileUrl.split("/").pop() ?? "file.pdf",
    fileType: "pdf",
    sha256Hash: status === "ok" ? "abc123" : null,
    downloadStatus: status,
    sizeBytes: status === "ok" ? 1024 : null,
    localPath: status === "ok" ? "/tmp/radar-docs/abc123.pdf" : null,
    errorMessage: status === "ok" ? null : "Timeout",
    downloadedAt: "2026-05-07T00:00:00Z",
  };
}

const baseData: EnrichedAlertData = {
  procedureNumber: "CAPUFE-2026-LO-001",
  expedienteId: "EXP-2026-001",
  title: "Mantenimiento correctivo de casetas de peaje",
  dependency: "CAPUFE",
  scope: "NATIONAL_CAPUFE_DESIERTA",
  documentsFound: [],
  documentsDownloaded: [],
  errors: [],
};

describe("formatEnrichedAlert", () => {
  it("sin documentos → mensaje corto con 'sin documentos públicos'", () => {
    const msg = formatEnrichedAlert({ ...baseData });

    expect(msg).toContain("CAPUFE-2026-LO-001");
    expect(msg).toContain("sin documentos públicos");
    expect(msg).not.toContain("Documentos encontrados");
  });

  it("con documentos → incluye sección documentos y conteo", () => {
    const doc = makeDocLink("Bases del procedimiento");
    const dl = makeDownloadResult(doc.fileUrl, "ok");
    const msg = formatEnrichedAlert({
      ...baseData,
      documentsFound: [doc],
      documentsDownloaded: [dl],
    });

    expect(msg).toContain("Documentos encontrados (1)");
    expect(msg).toContain("Bases del procedimiento");
    expect(msg).toContain("✅");
  });

  it("documento con descarga fallida → ⚠️ marker", () => {
    const doc = makeDocLink("Anexo Técnico");
    const dl = makeDownloadResult(doc.fileUrl, "failed");
    const msg = formatEnrichedAlert({
      ...baseData,
      documentsFound: [doc],
      documentsDownloaded: [dl],
    });

    expect(msg).toContain("⚠️");
  });

  it("con errores → sección errores presente", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      errors: ["Timeout en la conexión"],
    });

    expect(msg).toContain("Errores controlados");
    expect(msg).toContain("Timeout en la conexión");
  });

  it("sin errores → sin sección de errores", () => {
    const doc = makeDocLink("Bases");
    const dl = makeDownloadResult(doc.fileUrl, "ok");
    const msg = formatEnrichedAlert({
      ...baseData,
      documentsFound: [doc],
      documentsDownloaded: [dl],
      errors: [],
    });

    expect(msg).not.toContain("Errores controlados");
  });

  it("mensaje siempre contiene disclaimer legal", () => {
    const msg = formatEnrichedAlert(baseData);
    expect(msg).toContain("información pública");
  });
});
