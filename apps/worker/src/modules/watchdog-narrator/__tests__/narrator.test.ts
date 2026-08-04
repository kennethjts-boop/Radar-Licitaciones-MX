import {
  filterAndDeduplicateChanges,
  classifyChangeCategory,
  translateStatusMeaning,
  buildDeterministicNarrative,
} from "../classifier";
import type { WatchdogChange } from "../../licitacion-watchdog/types";

describe("Watchdog Narrator - Classifier & Templates", () => {
  it("debe filtrar ruido y colapsar pares duplicados", () => {
    const changes: WatchdogChange[] = [
      {
        kind: "modified",
        path: "detail.registro[0].estatus",
        previous: "VIGENTE PAP",
        current: "PENDIENTE DE APERTURA",
      },
      {
        kind: "modified",
        path: "visibleFields.Estatus del procedimiento de contratación",
        previous: "VIGENTE PAP",
        current: "PENDIENTE DE APERTURA",
      },
      {
        kind: "modified",
        path: "snapshot_hash",
        previous: "hash1",
        current: "hash2",
      },
    ];

    const deduplicated = filterAndDeduplicateChanges(changes);
    expect(deduplicated.length).toBe(1);
    expect(deduplicated[0].path).toBe("detail.registro[0].estatus");
  });

  it("debe clasificar correctamente las categorías", () => {
    expect(classifyChangeCategory({ kind: "modified", path: "detail.registro[0].estatus", previous: "A", current: "B" })).toBe("cambio_estatus");
    expect(classifyChangeCategory({ kind: "modified", path: "detail.registro[0].fecha_apertura", previous: "A", current: "B" })).toBe("fecha_apertura");
    expect(classifyChangeCategory({ kind: "modified", path: "visibleFields.Fecha de Junta de Aclaraciones", previous: "A", current: "B" })).toBe("fecha_junta");
    expect(classifyChangeCategory({ kind: "modified", path: "visibleFields.Fecha de Fallo", previous: "A", current: "B" })).toBe("fecha_fallo");
    expect(classifyChangeCategory({ kind: "document_added", path: "documents[0]", previous: undefined, current: {} as any })).toBe("documento_nuevo");
    expect(classifyChangeCategory({ kind: "modified", path: "visibleTables[0].rows[0]", previous: [], current: [] })).toBe("tabla_modificada");
    expect(classifyChangeCategory({ kind: "modified", path: "custom.campo_raro", previous: 1, current: 2 })).toBe("desconocido");
  });

  it("debe traducir correctamente el diccionario de estatus", () => {
    expect(translateStatusMeaning("VIGENTE")).toBe("todavía se pueden subir propuestas");
    expect(translateStatusMeaning("PENDIENTE DE APERTURA")).toBe("ya cerró la recepción, falta abrir sobres");
    expect(translateStatusMeaning("EN APERTURA")).toBe("están abriendo los sobres en este momento");
    expect(translateStatusMeaning("ADJUDICADA")).toBe("ya hay ganador");
    expect(translateStatusMeaning("CANCELADA")).toBe("el procedimiento se cayó");
  });

  it("debe renderizar la plantilla obligatoria para un cambio de estatus", () => {
    const result = buildDeterministicNarrative({
      alias: "CAPUFE · N-68",
      expedienteUrl: "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/123/procedimiento",
      changes: [
        {
          kind: "modified",
          path: "detail.registro[0].estatus",
          previous: "VIGENTE PAP",
          current: "PENDIENTE DE APERTURA",
        },
      ],
    });

    expect(result.category).toBe("cambio_estatus");
    expect(result.text).toContain("🔔 <b>CAPUFE · N-68</b>");
    expect(result.text).toContain("¿QUÉ PASÓ?");
    expect(result.text).toContain("El estatus cambió de <b>VIGENTE PAP</b> a <b>PENDIENTE DE APERTURA</b>.");
    expect(result.text).toContain("¿QUÉ SIGNIFICA?");
    expect(result.text).toContain("Significa que ya cerró la recepción, falta abrir sobres.");
    expect(result.text).toContain("¿QUÉ DEBO HACER?");
    expect(result.text).toContain("1. ");
    expect(result.text).toContain("2. ");
    expect(result.text).toContain("🔗 https://comprasmx.buengobierno.gob.mx/");
  });

  it("debe agregar bloque de detalle técnico para cambios desconocidos", () => {
    const result = buildDeterministicNarrative({
      alias: "GYR · N-33",
      expedienteUrl: "https://comprasmx.buengobierno.gob.mx/sitiopublico/",
      changes: [
        {
          kind: "modified",
          path: "campo_desconocido",
          previous: "antiguo",
          current: "nuevo",
        },
      ],
    });

    expect(result.category).toBe("desconocido");
    expect(result.text).toContain("Detalle técnico:");
    expect(result.text).toContain("campo_desconocido");
  });
});
