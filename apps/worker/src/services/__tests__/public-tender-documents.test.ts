import axios from "axios";
import { validatePublicDocumentUrl } from "../public-tender-documents";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("validatePublicDocumentUrl", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("acepta PDF público con HTTP 200 y content-type PDF", async () => {
    mockedAxios.head.mockResolvedValue({
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": "1234",
      },
    } as never);

    const result = await validatePublicDocumentUrl("https://example.com/convocatoria.pdf");

    expect(result.ok).toBe(true);
    expect(result.mimeType).toBe("application/pdf");
    expect(result.fileSize).toBe(1234);
  });

  it("rechaza URL privada o errónea que devuelve HTML", async () => {
    mockedAxios.head.mockResolvedValue({
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": "900",
      },
    } as never);
    mockedAxios.get.mockResolvedValue({
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": "900",
      },
      data: Buffer.from("<html><body>login</body></html>"),
    } as never);

    const result = await validatePublicDocumentUrl("https://example.com/session-only");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_download_content");
  });

  it("no acepta octet-stream solo por HEAD si el GET parcial revela HTML", async () => {
    mockedAxios.head.mockResolvedValue({
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": "1200",
      },
    } as never);
    mockedAxios.get.mockResolvedValue({
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": "1200",
      },
      data: Buffer.from("<!doctype html><html><body>forbidden</body></html>"),
    } as never);

    const result = await validatePublicDocumentUrl("https://example.com/documento.pdf");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_download_content");
    expect(mockedAxios.get).toHaveBeenCalled();
  });

  it("rechaza archivo vacío", async () => {
    mockedAxios.head.mockResolvedValue({
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": "0",
      },
    } as never);

    const result = await validatePublicDocumentUrl("https://example.com/empty.pdf");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("empty_file");
  });
});
