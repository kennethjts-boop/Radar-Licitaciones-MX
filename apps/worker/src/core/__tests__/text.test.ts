import {
  normalizeText,
  tokenize,
  buildCanonicalText,
  textContainsTerm,
  findMatchingTerms,
  findExcludedTerms,
  truncateForTelegram,
  formatCurrency,
} from "../text";

describe("normalizeText", () => {
  it("convierte a minúsculas", () => {
    expect(normalizeText("CAPUFE")).toBe("capufe");
  });

  it("elimina diacríticos", () => {
    expect(normalizeText("licitación")).toBe("licitacion");
  });

  it("reemplaza puntuación con espacios", () => {
    expect(normalizeText("a,b;c")).toBe("a b c");
  });

  it("colapsa espacios múltiples", () => {
    expect(normalizeText("  hola   mundo  ")).toBe("hola mundo");
  });

  it("maneja string vacío", () => {
    expect(normalizeText("")).toBe("");
  });
});

describe("textContainsTerm", () => {
  it("encuentra término normalizado en texto", () => {
    expect(textContainsTerm("Licitación CAPUFE 2024", "capufe")).toBe(true);
  });

  it("encuentra término con tildes en texto sin tildes", () => {
    expect(textContainsTerm("licitacion publica", "licitación")).toBe(true);
  });

  it("retorna false cuando el término no está", () => {
    expect(textContainsTerm("compras imss morelos", "capufe")).toBe(false);
  });
});

describe("findMatchingTerms", () => {
  it("retorna solo los términos que aparecen en el texto", () => {
    const result = findMatchingTerms("contrato de peaje capufe 2024", [
      "peaje",
      "imss",
      "capufe",
    ]);
    expect(result).toEqual(["peaje", "capufe"]);
  });

  it("retorna array vacío si no hay matches", () => {
    expect(findMatchingTerms("licitacion issste", ["capufe", "imss"])).toEqual([]);
  });

  it("retorna array vacío si terms list está vacía", () => {
    expect(findMatchingTerms("cualquier texto", [])).toEqual([]);
  });
});

describe("findExcludedTerms", () => {
  it("detecta términos de exclusión presentes", () => {
    expect(
      findExcludedTerms("convocatoria cancelada urgente", ["cancelada", "suspendida"])
    ).toEqual(["cancelada"]);
  });

  it("retorna vacío si no hay exclusiones en el texto", () => {
    expect(
      findExcludedTerms("licitación vigente peaje", ["cancelada", "desierta"])
    ).toEqual([]);
  });
});

describe("buildCanonicalText", () => {
  it("combina campos con separador |", () => {
    const result = buildCanonicalText({
      title: "Peaje",
      dependencyName: "CAPUFE",
      buyingUnit: "Administración Central",
    });
    expect(result).toBe("Peaje | CAPUFE | Administración Central");
  });

  it("omite campos nulos", () => {
    const result = buildCanonicalText({
      title: "Peaje",
      dependencyName: null,
      buyingUnit: null,
    });
    expect(result).toBe("Peaje");
  });

  it("omite campos vacíos", () => {
    const result = buildCanonicalText({
      title: "Peaje",
      description: "",
      dependencyName: "CAPUFE",
    });
    expect(result).toBe("Peaje | CAPUFE");
  });
});

describe("truncateForTelegram", () => {
  it("no trunca textos cortos", () => {
    const text = "Hola mundo";
    expect(truncateForTelegram(text)).toBe(text);
  });

  it("trunca textos que exceden 4000 chars y agrega ...", () => {
    const longText = "a".repeat(5000);
    const result = truncateForTelegram(longText);
    expect(result.length).toBe(4000);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("formatCurrency", () => {
  it("retorna 'No especificado' para amount null", () => {
    expect(formatCurrency(null, "MXN")).toBe("No especificado");
  });

  it("retorna 'No especificado' para amount 0", () => {
    expect(formatCurrency(0, "MXN")).toBe("No especificado");
  });

  it("formatea moneda positiva correctamente", () => {
    const result = formatCurrency(1000000, "MXN");
    expect(result).not.toBe("No especificado");
    expect(typeof result).toBe("string");
  });

  it("usa MXN como default cuando currency es null", () => {
    const result = formatCurrency(500, null);
    expect(result).not.toBe("No especificado");
  });
});

describe("tokenize", () => {
  it("extrae tokens únicos de mínimo 3 chars", () => {
    const result = tokenize("El contrato de CAPUFE es vigente");
    expect(result).toContain("contrato");
    expect(result).toContain("capufe");
    expect(result).toContain("vigente");
    expect(result).not.toContain("de");
    expect(result).not.toContain("el");
  });

  it("elimina duplicados", () => {
    const result = tokenize("capufe capufe peaje peaje");
    expect(result.filter((t) => t === "capufe").length).toBe(1);
  });
});
