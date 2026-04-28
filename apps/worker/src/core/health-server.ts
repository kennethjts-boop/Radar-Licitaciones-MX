/**
 * HEALTH SERVER — Servidor HTTP mínimo con GET /health.
 *
 * Responde: { status, lastCycle, uptime }
 * Puerto: HEALTH_PORT (default 8080).
 */
import http from "http";
import { createModuleLogger } from "./logger";
import { healthTracker } from "./healthcheck";

const log = createModuleLogger("health-server");

let server: http.Server | null = null;

export function startHealthServer(): void {
  const port = parseInt(process.env.HEALTH_PORT ?? "8080", 10);

  server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const hs = healthTracker.getStatus();
      const body = JSON.stringify({
        status: hs.overall,
        lastCycle: hs.lastCycleAt,
        uptime: Math.floor(hs.uptimeMs / 1000),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on("error", (err) => {
    log.error({ err }, "❌ Health server error");
  });

  server.listen(port, () => {
    log.info({ port }, "🌐 Health check endpoint activo: GET /health");
  });
}

export function stopHealthServer(): void {
  server?.close();
}
