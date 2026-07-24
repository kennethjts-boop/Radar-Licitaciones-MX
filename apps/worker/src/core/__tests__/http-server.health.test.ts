import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpServer } from "../http-server";
import {
  resetRuntimeHealthForTests,
  setBootstrapRuntimeStatus,
  setDatabaseRuntimeStatus,
  setTelegramPollingRuntimeStatus,
} from "../runtime-health";

describe("GET /health", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    resetRuntimeHealthForTests();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  });

  it("siempre responde 200 y reporta estados operativos como información", async () => {
    setBootstrapRuntimeStatus("failed");
    setDatabaseRuntimeStatus("error");
    setTelegramPollingRuntimeStatus("degraded");
    const server = createHttpServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    const response = await new Promise<{
      statusCode: number | undefined;
      body: Record<string, unknown>;
    }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/health`, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
              string,
              unknown
            >,
          });
        });
      }).on("error", reject);
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      bootstrap: "failed",
      telegramPolling: "degraded",
      db: "error",
    });
    expect(response.body.ts).toEqual(expect.any(String));
    expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
  });
});
