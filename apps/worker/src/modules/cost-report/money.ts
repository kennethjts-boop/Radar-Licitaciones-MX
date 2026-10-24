/** Monto USD legible; 4 decimales para montos menores a 1 centavo. */
export function usd(value: number): string {
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `${value < 0 ? "−" : ""}US$${abs.toFixed(digits)}`;
}

/** Siempre 4 decimales: para contrastar cifras de centavos. */
export function usd4(value: number): string {
  return `${value < 0 ? "−" : ""}US$${Math.abs(value).toFixed(4)}`;
}
