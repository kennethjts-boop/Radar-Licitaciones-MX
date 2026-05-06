# Financial Ceiling Radar

Módulo OSINT de análisis de techo financiero para licitaciones públicas mexicanas.

> **SOLO INFORMACIÓN PÚBLICA Y LEGAL** — Este módulo nunca accede a propuestas económicas privadas, evade captchas, usa credenciales ajenas ni explota APIs protegidas.

---

## ¿Qué hace?

Dado un número de licitación (o texto descriptivo), este módulo:

1. Busca la licitación actual en fuentes públicas (ComprasMX, PNT).
2. Extrae dependencia, unidad compradora y objeto de contratación.
3. Busca contratos históricos similares en fuentes públicas.
4. Calcula un **score de similitud** para identificar el **antecedente inmediato**.
5. Estima el **techo financiero probable** usando una jerarquía de confianza.
6. Entrega un reporte en formato JSON, Markdown y mensaje Telegram compacto.

## ¿Qué NO hace?

- ❌ No accede a propuestas económicas antes del fallo.
- ❌ No evade captchas.
- ❌ No usa credenciales ajenas.
- ❌ No ejecuta análisis automáticamente (solo bajo demanda).
- ❌ No modifica alertas existentes del radar.
- ❌ No toca lógica del scraper, scheduler, deduplicación ni Supabase.

---

## Variables de entorno

```env
# Activa el comando /techo en Telegram (manual, bajo demanda)
ENABLE_FINANCIAL_CEILING_COMMAND=true

# Análisis automático por cada alerta — MANTENER EN FALSE
ENABLE_FINANCIAL_CEILING_ENRICHMENT=false
```

---

## Cómo usar — CLI

```bash
# Análisis real (consulta fuentes públicas)
npm run financial:analyze -- --query "LA-050GYR019-E11-2026"

# Análisis con texto libre
npm run financial:analyze -- --query "mantenimiento vehicular CAPUFE 2026"

# Prueba con datos simulados (sin HTTP, sin .env)
npm run financial:sample
```

El resultado se guarda automáticamente en:
- `apps/worker/data/results/financial-ceiling-<timestamp>.json`
- `apps/worker/data/results/financial-ceiling-<timestamp>.md`

---

## Cómo usar — Telegram

```
/techo LA-050GYR019-E11-2026
/techo IA-917047998-E4-2026
/techo mantenimiento vehicular CAPUFE 2026
```

El bot responde de forma independiente, sin alterar alertas normales.

---

## Jerarquía de confianza

| Caso | Tipo | Confianza |
|------|------|-----------|
| Monto máximo / suficiencia presupuestal publicada | `confirmado_monto_maximo` | **ALTA** |
| Contrato abierto (min/max) | `contrato_abierto` | **ALTA** |
| Contrato anterior muy similar (score ≥ 80) | `antecedente_inmediato` | **MEDIA** |
| Histórico de contratos similares | `historico_similar` | **MEDIA** o **BAJA** |
| Sin datos suficientes | `no_determinado` | **BAJA** |

### Interpretación

- **ALTA**: Dato confirmado en documento público oficial. Usar con alta confianza.
- **MEDIA**: Estimación basada en contrato anterior similar. Verificar antes de usarlo.
- **BAJA**: Estimación con pocos datos. Solo referencial.

---

## Scoring de similitud

| Criterio | Puntos |
|----------|--------|
| Misma dependencia | +25 |
| Misma unidad compradora | +20 |
| Coincidencia fuerte en objeto (Jaccard ≥ 60%) | +30 |
| Coincidencia parcial en objeto (Jaccard ≥ 30%) | +15 |
| Mismo CUCOP | +25 |
| Misma partida presupuestal | +15 |
| Mismo proveedor recurrente | +10 |
| Año anterior inmediato | +15 |
| Documento oficial con monto claro | +20 |

**Clasificación:**
- 80-100 → antecedente fuerte
- 60-79 → antecedente probable
- 40-59 → antecedente débil
- < 40 → no usar

---

## Archivos del módulo

```
src/modules/financial-ceiling-radar/
├── index.ts              — Barrel exports
├── types.ts              — Tipos TypeScript
├── normalizer.ts         — Normalización de texto / tokenización
├── scorer.ts             — Scoring de similitud entre contratos
├── fetcher.ts            — Consulta de fuentes públicas (HTTP seguro)
├── estimator.ts          — Lógica de estimación del techo
├── reporter.ts           — Generación JSON y Markdown
├── telegram-formatter.ts — Formato de mensaje Telegram (HTML)
├── telegram-handler.ts   — Handler del comando /techo (aislado)
└── sample-data.ts        — Datos simulados para pruebas

src/scripts/
├── financial-analyze.ts  — CLI principal
└── financial-sample.ts   — CLI de prueba con datos simulados
```

---

## Fuentes públicas consultadas

- ComprasMX / CompraNet (`comprasmx.buengobierno.gob.mx`)
- Plataforma Nacional de Transparencia (`plataformadetransparencia.org.mx`)
- Portales de dependencias (Hacienda, IMSS, CAPUFE, etc.)

Si una fuente requiere login, captcha o bloquea el acceso:
- Se registra en logs con el motivo.
- Se marca como `blocked`, `captcha` o `error` en el reporte.
- El análisis continúa con las fuentes disponibles.

---

## Limitaciones conocidas

1. ComprasMX puede cambiar su API o estructuras de respuesta.
2. La PNT tiene muchas secciones que requieren autenticación.
3. El análisis de texto libre es menos preciso que el número de licitación.
4. La variación de inflación estimada (7%) es referencial.
5. Los contratos no siempre publican el monto final de forma estructurada.

---

## Cómo integrar el /techo en el bot (ya hecho)

La integración mínima ya está aplicada en `src/agent/telegram.commands.ts`.

Para revertir, eliminar el bloque `/techo` al final de `registerCommands()`.

---

## Rama de trabajo

```
feature/financial-ceiling-radar
```

**No hacer merge a main sin revisión.**
