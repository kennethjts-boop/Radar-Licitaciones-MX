import type { Page } from "playwright";
import { ComprasMxNavigator } from "../comprasmx.navigator";

type FakeElement = {
  textContent: string;
  nextElementSibling: FakeElement | null;
  parentElement: FakeElement | null;
  children: FakeElement[];
};

const element = (textContent: string): FakeElement => ({
  textContent,
  nextElementSibling: null,
  parentElement: null,
  children: [],
});

function pageWithElements(elements: FakeElement[]): Page {
  return {
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(async (callback: () => string | null) => {
      const testGlobal = globalThis as typeof globalThis & { document?: unknown };
      const priorDocument = testGlobal.document;
      Object.defineProperty(testGlobal, "document", {
        configurable: true,
        value: { querySelectorAll: () => elements },
      });
      try {
        return callback();
      } finally {
        Object.defineProperty(testGlobal, "document", {
          configurable: true,
          value: priorDocument,
        });
      }
    }),
  } as unknown as Page;
}

describe("ComprasMxNavigator.fetchPublicationDate", () => {
  it("extrae únicamente la fecha oficial adyacente a su etiqueta", async () => {
    const label = element("Fecha y hora de publicación:");
    const value = element("13/08/2026 13:04");
    label.nextElementSibling = value;

    await expect(
      new ComprasMxNavigator().fetchPublicationDate(pageWithElements([label])),
    ).resolves.toBe("13/08/2026 13:04");
  });

  it("prioriza la fecha contenida en la misma celda y no la del evento siguiente", async () => {
    const publicationCell = element(
      "Fecha y hora de publicación:13/08/2026 13:04",
    );
    publicationCell.nextElementSibling = element(
      "Fecha y hora de presentación y apertura de proposiciones:28/08/2026 10:00",
    );

    await expect(
      new ComprasMxNavigator().fetchPublicationDate(
        pageWithElements([publicationCell]),
      ),
    ).resolves.toBe("13/08/2026 13:04");
  });

  it("no confunde el año del pie de página con la fecha de publicación", async () => {
    const container = element("Fecha y hora de publicación:");
    container.nextElementSibling = element("© 2025 | 1.0.0 Términos y condiciones");

    await expect(
      new ComprasMxNavigator().fetchPublicationDate(pageWithElements([container])),
    ).resolves.toBeNull();
  });
});
