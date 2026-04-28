/**
 * CIRCUIT BREAKER — Protección para ComprasMX.
 *
 * Estados:
 *   CLOSED   → operación normal
 *   OPEN     → 5 fallos consecutivos; pausa ciclos 60 min; envía alerta Telegram
 *   HALF_OPEN→ transcurridos 60 min; 1 ciclo de prueba
 *               Si funciona → CLOSED
 *               Si falla    → OPEN otros 60 min
 */
import { createModuleLogger } from "./logger";

const log = createModuleLogger("circuit-breaker");

const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT_MS = 60 * 60 * 1000; // 60 min

type CBState = "CLOSED" | "OPEN" | "HALF_OPEN";

class CircuitBreaker {
  private state: CBState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  /** Telegram alert sent flag — para no repetir la alerta mientras sigue OPEN */
  private alertSentForCurrentOpen = false;

  /** Retorna true si el ciclo debe saltarse (OPEN y no ha expirado). */
  shouldSkip(): boolean {
    if (this.state === "OPEN") {
      const elapsed = this.openedAt ? Date.now() - this.openedAt : 0;
      if (elapsed >= RESET_TIMEOUT_MS) {
        this.state = "HALF_OPEN";
        this.alertSentForCurrentOpen = false;
        log.info("⚡ Circuit breaker → HALF_OPEN: probando 1 ciclo de prueba");
        return false;
      }
      const remainingMin = Math.ceil((RESET_TIMEOUT_MS - elapsed) / 60_000);
      log.warn({ remainingMin }, "⚡ Circuit breaker OPEN — ciclo omitido, servicio en pausa");
      return true;
    }
    return false;
  }

  /** Llamar cuando el ciclo termina con éxito. */
  recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      log.info("✅ Circuit breaker → CLOSED: ComprasMX recuperado");
    }
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.alertSentForCurrentOpen = false;
  }

  /**
   * Llamar cuando el ciclo falla.
   * @returns La alerta Telegram a enviar, o null si ya fue enviada / no aplica.
   */
  recordFailure(): string | null {
    this.consecutiveFailures++;

    if (this.state === "HALF_OPEN" || this.consecutiveFailures >= FAILURE_THRESHOLD) {
      const wasOpen = this.state === "OPEN";
      const wasHalfOpen = this.state === "HALF_OPEN";
      this.state = "OPEN";
      this.openedAt = Date.now();
      this.consecutiveFailures = 0;

      log.error(
        { openedAt: new Date(this.openedAt).toISOString(), wasHalfOpen },
        "⚡ Circuit breaker → OPEN",
      );

      if (!wasOpen && !this.alertSentForCurrentOpen) {
        this.alertSentForCurrentOpen = true;
        return "⚡ Circuit breaker activado — ComprasMX no responde. Pausando 60 min.";
      }
    } else {
      log.warn(
        { consecutiveFailures: this.consecutiveFailures, threshold: FAILURE_THRESHOLD },
        "⚠️ Fallo registrado en circuit breaker",
      );
    }

    return null;
  }

  getState(): CBState {
    return this.state;
  }
}

export const comprasMxCB = new CircuitBreaker();
