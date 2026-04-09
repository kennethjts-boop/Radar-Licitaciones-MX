# Modelo de Datos — Radar Licitaciones MX

## Contrato Central: NormalizedProcurement

Todo expediente que circule internamente debe cumplir este contrato:

```typescript
interface NormalizedProcurement {
  // Fuente
  source: string;                    // 'comprasmx' | 'dof' | ...
  sourceUrl: string;                 // URL del expediente (OBLIGATORIO)
  externalId: string;                // ID único en la fuente

  // Identificadores
  expedienteId: string | null;       // e.g. EA-009000002-E1-2024
  licitationNumber: string | null;   // Número de licitación oficial
  procedureNumber: string | null;    // Número de procedimiento (puede diferir)

  // Descripción
  title: string;                     // OBLIGATORIO
  description: string | null;

  // Entidades
  dependencyName: string | null;
  buyingUnit: string | null;

  // Clasificación
  procedureType: ProcedureType;      // 'licitacion_publica' | ...
  status: ProcurementStatus;         // 'publicada' | 'desierta' | ...

  // Fechas (ISO-8601)
  publicationDate: string | null;
  openingDate: string | null;
  awardDate: string | null;

  // Geografía
  state: string | null;
  municipality: string | null;

  // Económico
  amount: number | null;
  currency: 'MXN' | 'USD' | null;

  // Adjuntos
  attachments: ProcurementAttachment[];

  // Texto canónico (para matching)
  canonicalText: string;             // título + desc + dependencia + unidad + adjuntos
  canonicalFingerprint: string;      // SHA-256(canonicalText)

  // Raw preservado
  rawJson: Record<string, unknown>;

  // Meta
  fetchedAt: string;                 // ISO-8601 UTC
}
```

---

## Reglas del Contrato

1. `sourceUrl` es siempre obligatorio — nunca nulo
2. `licitationNumber` y `procedureNumber` son campos separados
3. Si el portal no expone número de licitación, guardar `null` — **no inventar**
4. Si el número se detecta en PDF adjunto, extraerlo y guardarlo
5. `canonicalText` = `title | description | dependencyName | buyingUnit | attachmentTexts`
6. `canonicalFingerprint` = SHA-256 del canonicalText normalizado (sin tildes, minúsculas)
7. `rawJson` siempre se preserva — nunca modificar el raw original

---

## Flujo de Fingerprints

```
canonicalText
    │── normalizeText() ──► texto sin tildes, lowercase, sin puntuación
    │
    └── sha256() ──────────► canonicalFingerprint (32 chars hex)

                                    │
                    ┌───────────────┴────────────────┐
                    │                                │
              [primera vez]                   [actualización]
                    │                                │
              INSERT procurement           ¿canonicalFingerprint cambió?
              versión 1                         SÍ → UPDATE + versión N
                                                NO → only last_seen_at
```

---

## Tablas y Relaciones

```
sources
  └── collect_runs (source_id)
  └── raw_items (source_id)
  └── procurements (source_id)
        └── procurement_versions (procurement_id)
        └── attachments (procurement_id)
        └── matches (procurement_id)
              └── radar_id → radars
        └── alerts (procurement_id)
              └── radar_id → radars

radars
  └── radar_rules (radar_id)
  └── matches (radar_id)
  └── alerts (radar_id)

entity_memory (standalone - entity helper)
system_state (standalone - key-value)
daily_summaries (standalone)
telegram_logs (standalone)
```
