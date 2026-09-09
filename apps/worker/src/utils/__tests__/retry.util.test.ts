import { isRetryableNetworkError } from "../retry.util";

describe("isRetryableNetworkError", () => {
  it("considera reintentable un error con mensaje de red (429)", () => {
    const err = new Error("Too Many Requests: 429");
    expect(isRetryableNetworkError(err)).toBe(true);
  });

  it("NO considera reintentable un error cuyo mensaje no es de red aunque su stack contenga '429'", () => {
    const err = new Error("Validación de esquema fallida");
    // Simula un stack que casualmente contiene un número de línea "429"
    // (ej. archivo.ts:429:10), lo que no debe activar el retry.
    err.stack = `Error: Validación de esquema fallida\n    at parseSchema (/app/src/foo.ts:429:10)`;
    expect(isRetryableNetworkError(err)).toBe(false);
  });

  it("NO considera reintentable un error cuyo mensaje no es de red aunque su stack contenga '503'", () => {
    const err = new Error("Campo requerido ausente");
    err.stack = `Error: Campo requerido ausente\n    at handler (/app/src/bar.ts:503:1)`;
    expect(isRetryableNetworkError(err)).toBe(false);
  });

  it("sigue considerando reintentable un error con token de red en el name", () => {
    const err = new Error("algo salió mal");
    err.name = "ETIMEDOUT";
    expect(isRetryableNetworkError(err)).toBe(true);
  });

  it("no falla con valores que no son Error", () => {
    expect(isRetryableNetworkError("plain string 429")).toBe(false);
    expect(isRetryableNetworkError(null)).toBe(false);
  });
});
