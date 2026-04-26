# Limpieza Radares No-ComprasMX + Verificación Playwright

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar todos los radares, jobs y collectors que NO son de ComprasMX; verificar que el colector Playwright funciona correctamente end-to-end; confirmar flujo Supabase + Telegram; typecheck + build verde; commit.

**Architecture:** El sistema tiene tres subsistemas no-ComprasMX a eliminar: (1) Subastas USA/MX con 5 collectors Playwright/axios y su radar + job diario. (2) Fondos internacionales con 6 collectors axios/cheerio, radar config y job programado. (3) Radares de mercados financieros (acciones, petróleo, apuestas) con sus jobs diarios — estos ya no estaban en el scheduler pero aún compilaban. Tras la limpieza, el scheduler queda con solo 3 crons: Modo 1 (listing scan), Modo 2 (daily recheck), Resumen diario.

**Tech Stack:** TypeScript 5, Node 20, Playwright 1.48.0, Supabase, node-cron, Telegram Bot API, Railway (Docker multi-stage)

---

## Mapa de archivos a ELIMINAR

### Radares a eliminar
- `apps/worker/src/radars/subastas.radar.ts`
- `apps/worker/src/radars/fondos-salud.radar.ts`
- `apps/worker/src/radars/fondos-deporte.radar.ts`
- `apps/worker/src/radars/fondos-cultura.radar.ts`
- `apps/worker/src/radars/acciones.radar.ts`
- `apps/worker/src/radars/apuestas.radar.ts`
- `apps/worker/src/radars/petroleo.radar.ts`

### Jobs a eliminar
- `apps/worker/src/jobs/daily-subastas.job.ts`
- `apps/worker/src/jobs/daily-acciones.job.ts`
- `apps/worker/src/jobs/daily-apuestas.job.ts`
- `apps/worker/src/jobs/daily-petroleo.job.ts`
- `apps/worker/src/jobs/collect-fondos.job.ts`

### Collectors a eliminar
- `apps/worker/src/collectors/subastas/govplanet.collector.ts`
- `apps/worker/src/collectors/subastas/gsa.collector.ts`
- `apps/worker/src/collectors/subastas/publicsurplus.collector.ts`
- `apps/worker/src/collectors/subastas/sae-indep.collector.ts`
- `apps/worker/src/collectors/subastas/index.ts`
- `apps/worker/src/collectors/fondos/cecani.collector.ts`
- `apps/worker/src/collectors/fondos/concausa.collector.ts`
- `apps/worker/src/collectors/fondos/coprev.collector.ts`
- `apps/worker/src/collectors/fondos/gestionandote.collector.ts`
- `apps/worker/src/collectors/fondos/inah.collector.ts`
- `apps/worker/src/collectors/fondos/montepiedad.collector.ts`

## Mapa de archivos a MODIFICAR

- `apps/worker/src/radars/index.ts` — quitar 4 imports + 3 entradas del array RADARS
- `apps/worker/src/jobs/scheduler.ts` — quitar import + bloque cron de fondos (líneas 23 y 96-115)
- `apps/worker/src/config/env.ts` — quitar campo `FONDOS_ENABLED` del schema (líneas 51-55)

## Mapa de archivos a CONSERVAR (no tocar)

### Collectors ComprasMX (todos intactos)
- `apps/worker/src/collectors/comprasmx/browser.manager.ts`
- `apps/worker/src/collectors/comprasmx/comprasmx.collector.ts`
- `apps/worker/src/collectors/comprasmx/comprasmx.downloader.ts`
- `apps/worker/src/collectors/comprasmx/comprasmx.navigator.ts`

### Radares ComprasMX (todos intactos)
- `apps/worker/src/radars/capufe-emergencia.radar.ts`
- `apps/worker/src/radars/capufe-mantenimiento-equipos.radar.ts`
- `apps/worker/src/radars/capufe-peaje.radar.ts`
- `apps/worker/src/radars/capufe-oportunidades.radar.ts`
- `apps/worker/src/radars/issste-oficinas-centrales.radar.ts`
- `apps/worker/src/radars/conavi-federal.radar.ts`
- `apps/worker/src/radars/imss-morelos.radar.ts`
- `apps/worker/src/radars/imss-bienestar-morelos.radar.ts`
- `apps/worker/src/radars/habitat-morelos.radar.ts`

### Jobs ComprasMX (todos intactos)
- `apps/worker/src/jobs/collect.job.ts`
- `apps/worker/src/jobs/daily-summary.job.ts`
- `apps/worker/src/jobs/heartbeat.job.ts`
- `apps/worker/src/jobs/scheduler.ts` (solo se modifica)

### Infraestructura (todos intactos)
- `apps/worker/src/storage/*`
- `apps/worker/src/alerts/*`
- `apps/worker/src/core/*`
- `apps/worker/src/matchers/*`
- `apps/worker/src/normalizers/*`
- `apps/worker/src/enrichers/*`
- `apps/worker/src/types/*`
- `apps/worker/src/config/env.ts` (solo se modifica)
- `apps/worker/src/index.ts`
- `apps/worker/src/bootstrap.ts`

---

## Task 1: Eliminar archivos de radares no-ComprasMX

**Files:**
- Delete: `apps/worker/src/radars/subastas.radar.ts`
- Delete: `apps/worker/src/radars/fondos-salud.radar.ts`
- Delete: `apps/worker/src/radars/fondos-deporte.radar.ts`
- Delete: `apps/worker/src/radars/fondos-cultura.radar.ts`
- Delete: `apps/worker/src/radars/acciones.radar.ts`
- Delete: `apps/worker/src/radars/apuestas.radar.ts`
- Delete: `apps/worker/src/radars/petroleo.radar.ts`

- [ ] **Step 1: Eliminar los 7 archivos de radares**

```bash
cd /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX/apps/worker
rm src/radars/subastas.radar.ts
rm src/radars/fondos-salud.radar.ts
rm src/radars/fondos-deporte.radar.ts
rm src/radars/fondos-cultura.radar.ts
rm src/radars/acciones.radar.ts
rm src/radars/apuestas.radar.ts
rm src/radars/petroleo.radar.ts
```

- [ ] **Step 2: Verificar que los archivos ya no existen**

```bash
ls src/radars/
```

Esperado: Solo deben aparecer los radares ComprasMX:
`capufe-emergencia.radar.ts`, `capufe-mantenimiento-equipos.radar.ts`,
`capufe-oportunidades.radar.ts`, `capufe-peaje.radar.ts`,
`conavi-federal.radar.ts`, `habitat-morelos.radar.ts`,
`imss-bienestar-morelos.radar.ts`, `imss-morelos.radar.ts`,
`issste-oficinas-centrales.radar.ts`, `index.ts`

---

## Task 2: Eliminar jobs no-ComprasMX

**Files:**
- Delete: `apps/worker/src/jobs/daily-subastas.job.ts`
- Delete: `apps/worker/src/jobs/daily-acciones.job.ts`
- Delete: `apps/worker/src/jobs/daily-apuestas.job.ts`
- Delete: `apps/worker/src/jobs/daily-petroleo.job.ts`
- Delete: `apps/worker/src/jobs/collect-fondos.job.ts`

- [ ] **Step 1: Eliminar los 5 job files**

```bash
cd /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX/apps/worker
rm src/jobs/daily-subastas.job.ts
rm src/jobs/daily-acciones.job.ts
rm src/jobs/daily-apuestas.job.ts
rm src/jobs/daily-petroleo.job.ts
rm src/jobs/collect-fondos.job.ts
```

- [ ] **Step 2: Verificar que los archivos correctos persisten**

```bash
ls src/jobs/
```

Esperado: `collect.job.ts`, `daily-summary.job.ts`, `heartbeat.job.ts`, `scheduler.ts`

---

## Task 3: Eliminar collectors no-ComprasMX

**Files:**
- Delete: `apps/worker/src/collectors/subastas/` (5 archivos)
- Delete: `apps/worker/src/collectors/fondos/` (6 archivos)

- [ ] **Step 1: Eliminar directorio de subastas**

```bash
cd /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX/apps/worker
rm -rf src/collectors/subastas/
```

- [ ] **Step 2: Eliminar directorio de fondos**

```bash
rm -rf src/collectors/fondos/
```

- [ ] **Step 3: Verificar que collectors ComprasMX no fueron tocados**

```bash
ls src/collectors/
ls src/collectors/comprasmx/
```

Esperado en `collectors/`: `comprasmx/`, `dof/`, `fallback_search/`, `institutional_sites/`
Esperado en `collectors/comprasmx/`: `browser.manager.ts`, `comprasmx.collector.ts`, `comprasmx.downloader.ts`, `comprasmx.navigator.ts`

---

## Task 4: Actualizar radars/index.ts

**Files:**
- Modify: `apps/worker/src/radars/index.ts`

El archivo actual tiene en líneas 16-19 los imports de fondos y subastas, y en líneas 36-39 los fondos en el array RADARS. El import de `subastasRadar` (línea 19) estaba sin usar en RADARS pero sí existía.

- [ ] **Step 1: Editar radars/index.ts — quitar imports y entradas del array**

Contenido resultante completo para `apps/worker/src/radars/index.ts`:

```typescript
/**
 * RADARS — Registro central de todos los radares activos.
 * Para agregar un radar: importarlo y añadirlo al array RADARS.
 */
import type { RadarConfig } from "../types/procurement";

import { capufeEmergenciaRadar } from "./capufe-emergencia.radar";
import { capufeMantenimientoEquiposRadar } from "./capufe-mantenimiento-equipos.radar";
import { capufePeajeRadar } from "./capufe-peaje.radar";
import { capufeOportunidadesRadar } from "./capufe-oportunidades.radar";
import { isssteoOficinasCentralesRadar } from "./issste-oficinas-centrales.radar";
import { conaviFederalRadar } from "./conavi-federal.radar";
import { imssMorelosRadar } from "./imss-morelos.radar";
import { imssBienestarMorelosRadar } from "./imss-bienestar-morelos.radar";
import { habitatMorelosRadar } from "./habitat-morelos.radar";

/**
 * Lista canónica de todos los radares.
 * El matcher itera sobre esta lista en cada ciclo.
 */
export const RADARS: RadarConfig[] = [
  capufeEmergenciaRadar,
  capufeMantenimientoEquiposRadar,
  capufePeajeRadar,
  capufeOportunidadesRadar,
  isssteoOficinasCentralesRadar,
  conaviFederalRadar,
  imssMorelosRadar,
  imssBienestarMorelosRadar,
  habitatMorelosRadar,
];

/**
 * Retorna los radares activos ordenados por prioridad.
 */
export function getActiveRadars(): RadarConfig[] {
  return RADARS.filter((r) => r.isActive).sort(
    (a, b) => a.priority - b.priority,
  );
}

/**
 * Busca un radar por su key.
 */
export function getRadarByKey(key: string): RadarConfig | undefined {
  return RADARS.find((r) => r.key === key);
}
```

---

## Task 5: Actualizar scheduler.ts — quitar bloque fondos

**Files:**
- Modify: `apps/worker/src/jobs/scheduler.ts`

Las líneas a quitar:
- Línea 23: `import { runCollectFondosJob } from "./collect-fondos.job";`
- Líneas 96-115: el bloque `// ── FONDOS: ...` completo (la constante `fondosCron`, el `if (config.FONDOS_ENABLED)` y el `else` con el warn)
- Líneas 134-138: las referencias a `fondos` en el objeto de log final

- [ ] **Step 1: Quitar import de runCollectFondosJob (línea 23)**

Usar Edit: old_string exacto:
```
import { runCollectFondosJob } from "./collect-fondos.job";
```
new_string: `` (línea en blanco vacía, o simplemente eliminar)

- [ ] **Step 2: Quitar bloque fondos cron (líneas 96-115)**

Usar Edit para eliminar desde `  // ── FONDOS: Convocatorias internacionales para donatarias autorizadas ────────` hasta el cierre del bloque `else { log.warn(...) }` inclusive, incluyendo la línea en blanco después.

El bloque exacto a eliminar (entre los dos crons que quedan) es:

```typescript
  // ── FONDOS: Convocatorias internacionales para donatarias autorizadas ────────
  // Corre cada 6 horas — estas fuentes no cambian tan frecuentemente.
  const fondosCron = "0 */6 * * *";

  if (config.FONDOS_ENABLED) {
    cron.schedule(
      fondosCron,
      async () => {
        log.info({ cron: fondosCron }, "Disparando colección de fondos internacionales");
        try {
          await runCollectFondosJob();
        } catch (err) {
          log.error({ err }, "Error no manejado en collect-fondos job");
        }
      },
      { timezone: "America/Mexico_City" },
    );
  } else {
    log.warn("⏸️  FONDOS_ENABLED=false — collector de fondos internacionales PAUSADO (los demás scrapers siguen activos)");
  }

```

- [ ] **Step 3: Quitar referencia a fondos en el log de arranque (líneas ~134-138)**

El bloque final de log tiene esta clave `fondos`:
```typescript
      fondos: config.FONDOS_ENABLED
        ? { cron: fondosCron, description: "Fondos internacionales donatarias" }
        : { status: "PAUSED", reason: "FONDOS_ENABLED=false" },
```
Eliminarla (incluyendo la coma al final de la línea anterior si es necesario).

El string del mensaje log final también menciona fondos:
```
    `✅ Scheduler iniciado — Modo 1 cada ${intervalMinutes} min, Modo 2 a las ${recheckHour}:00, Resumen a las ${summaryHour}:00, Fondos cada 6h`,
```
Actualizarlo a:
```
    `✅ Scheduler iniciado — Modo 1 cada ${intervalMinutes} min, Modo 2 a las ${recheckHour}:00, Resumen a las ${summaryHour}:00`,
```

---

## Task 6: Limpiar FONDOS_ENABLED de env.ts

**Files:**
- Modify: `apps/worker/src/config/env.ts`

- [ ] **Step 1: Quitar el campo FONDOS_ENABLED del schema Zod**

Eliminar las líneas 51-55:
```typescript
  // Fondos internacionales — deshabilitado permanentemente
  FONDOS_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

```

> **Nota:** `getConfig()` retorna `AppConfig = z.infer<typeof envSchema>`. Al quitar este campo del schema, `config.FONDOS_ENABLED` dejará de existir en el tipo — por eso es imprescindible que el Task 5 (scheduler.ts) se complete antes de hacer typecheck.

---

## Task 7: Typecheck en verde

**Files:** (ningún archivo nuevo, solo verificación)

- [ ] **Step 1: Ejecutar typecheck**

```bash
cd /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX/apps/worker
npm run typecheck
```

Esperado: `0 errors` — sin output de error de TypeScript.

Si aparece algún error:

| Error | Causa probable | Fix |
|---|---|---|
| `Cannot find module './fondos-salud.radar'` | radars/index.ts no fue editado | Completar Task 4 |
| `Property 'FONDOS_ENABLED' does not exist` | scheduler.ts aún referencia FONDOS_ENABLED | Completar Task 5 Step 3 |
| `Cannot find module './collect-fondos.job'` | import no eliminado en scheduler | Completar Task 5 Step 1 |
| `Cannot find module '../collectors/subastas'` | subastas.radar no eliminado o aún importado | Confirmar Task 3 |

---

## Task 8: Build en verde

- [ ] **Step 1: Ejecutar build**

```bash
cd /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX/apps/worker
npm run build
```

Esperado: `tsc` completa sin errores. Output: ningún mensaje de error, archivos `.js` generados en `dist/`.

- [ ] **Step 2: Verificar que el entry point compiló**

```bash
ls dist/index.js
```

Esperado: el archivo existe.

---

## Task 9: Análisis y verificación del colector Playwright

Esta tarea es analítica (no modifica código). Documenta el estado del colector ComprasMX y cualquier issue encontrado.

**Files:**
- Read: `apps/worker/src/collectors/comprasmx/browser.manager.ts`
- Read: `apps/worker/src/collectors/comprasmx/comprasmx.navigator.ts`
- Read: `apps/worker/Dockerfile`

- [ ] **Step 1: Verificar configuración de Chromium headless**

El `BrowserManager` lanza Chromium con estos flags seguros para Docker:
```
--no-sandbox
--disable-setuid-sandbox
--disable-dev-shm-usage   ← crucial para evitar OOM en Docker
--disable-gpu
--disable-blink-features=AutomationControlled
--blink-settings=imagesEnabled=false
```
El Dockerfile usa `mcr.microsoft.com/playwright:v1.48.0-jammy` y ejecuta `npx playwright install --with-deps chromium`. Esta combinación es correcta para Railway.

**Verificar que package.json y Dockerfile usan la misma versión de Playwright:**

```bash
cd /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX/apps/worker
grep '"playwright"' package.json
grep 'playwright' Dockerfile
```

Esperado: `"playwright": "1.48.0"` en package.json y `playwright:v1.48.0-jammy` en Dockerfile. Si divergen, actualizar el Dockerfile para que coincida.

- [ ] **Step 2: Verificar interceptación del endpoint API**

En `comprasmx.navigator.ts` el código de interceptación es:
```typescript
const captureApiRegistros = (response) => {
  if (!response.url().includes('/whitney/')) return;
  // parsea: { success, data: [{ registros: [...] }] }
```

El endpoint real es `https://comprasmx.buengobierno.gob.mx/whitney/sitiopublico/expedientes`.
La condición `.includes('/whitney/')` captura correctamente este endpoint.

La estructura parseada asume `json.data[0].registros` — si la API cambia esta estructura el collector retornará `apiRegistros.size === 0` y todos los rows quedarán sin datos API (se generarán errores `"Sin datos API para: <id>"`). No hay bug en el código actual para la estructura conocida.

- [ ] **Step 3: Verificar flujo Supabase + Telegram cuando hay match**

En `collect.job.ts` el flujo por cada item con match es:
```
upsertProcurement(item, sourceId)
  → evaluateAllRadars(item, radars, isNew, previousStatus)
    → [por cada match]
      enrichMatch(item, match)
      createAlert(enriched)          // INSERT en match_alerts
      sendMatchAlert(enriched)       // POST a Telegram Bot API — INMEDIATO, no batch
      markAlertSent(alertId, msgId)  // UPDATE match_alerts.sent_at
```

La alerta se envía dentro del mismo ciclo, inmediatamente tras el match. No hay batch posterior. La constante `MAX_ALERTS_PER_CYCLE = 10` limita las alertas de Telegram por ciclo de colección (el match sigue guardándose en DB aunque no se envíe por Telegram si se supera el límite).

No se encontraron bugs en este flujo. El comportamiento es correcto.

- [ ] **Step 4: Verificar script de test run del colector**

```bash
cat src/scripts/run-collector.ts | head -30
```

Si existe un script de prueba, documentar el comando para correrlo manualmente en Railway cuando se necesite verificar conectividad al portal.

---

## Task 10: Commit y push

- [ ] **Step 1: Revisar estado del repositorio**

```bash
cd /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX
git status
git diff --stat
```

- [ ] **Step 2: Staging de todos los cambios**

```bash
git add apps/worker/src/radars/index.ts
git add apps/worker/src/jobs/scheduler.ts
git add apps/worker/src/config/env.ts
git add -u apps/worker/src/radars/
git add -u apps/worker/src/jobs/
git add -u apps/worker/src/collectors/
```

El flag `-u` registra los deletes en git para los archivos ya trackeados.

- [ ] **Step 3: Crear commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: eliminar radares no comprasmx, verificar colector playwright

- Eliminados 7 radares: subastas, fondos-salud, fondos-deporte,
  fondos-cultura, acciones, apuestas, petroleo
- Eliminados 5 jobs: daily-subastas, daily-acciones, daily-apuestas,
  daily-petroleo, collect-fondos
- Eliminados 11 collectors: subastas/* (5), fondos/* (6)
- Actualizado radars/index.ts: solo 9 radares ComprasMX activos
- Actualizado scheduler.ts: eliminado bloque cron de fondos internacionales
- Actualizado env.ts: eliminado campo FONDOS_ENABLED del schema Zod
- Verificado: Playwright BrowserManager + Docker image v1.48.0 consistentes
- Verificado: flujo upsert→match→alert Supabase+Telegram intacto

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push a main**

```bash
git push origin main
```

---

## Reporte final esperado

### Archivos eliminados (23 total)
**Radares (7):** subastas.radar.ts, fondos-salud.radar.ts, fondos-deporte.radar.ts, fondos-cultura.radar.ts, acciones.radar.ts, apuestas.radar.ts, petroleo.radar.ts

**Jobs (5):** daily-subastas.job.ts, daily-acciones.job.ts, daily-apuestas.job.ts, daily-petroleo.job.ts, collect-fondos.job.ts

**Collectors fondos (6):** cecani.collector.ts, concausa.collector.ts, coprev.collector.ts, gestionandote.collector.ts, inah.collector.ts, montepiedad.collector.ts

**Collectors subastas (5):** govplanet.collector.ts, gsa.collector.ts, publicsurplus.collector.ts, sae-indep.collector.ts, index.ts

### Archivos modificados (3)
- `radars/index.ts` — 4 imports eliminados, 3 entradas del RADARS array eliminadas
- `jobs/scheduler.ts` — import + bloque fondos cron eliminados
- `config/env.ts` — campo FONDOS_ENABLED eliminado del schema

### Collectors ComprasMX NO tocados (confirmados)
- `collectors/comprasmx/browser.manager.ts` ✓
- `collectors/comprasmx/comprasmx.collector.ts` ✓
- `collectors/comprasmx/comprasmx.downloader.ts` ✓
- `collectors/comprasmx/comprasmx.navigator.ts` ✓

### Playwright
- Chromium headless: correcto (flags Docker-safe confirmados)
- Endpoint interceptado: `/whitney/sitiopublico/expedientes` ✓
- Parsing JSON: `data[0].registros[]` ✓
- No se encontraron bugs en la configuración actual

---

## Self-Review checklist

- [x] **Cobertura del spec:** Fase 1 (Tasks 1-6), Fase 2 (Task 9), Fase 3 (Tasks 7-8, 10) — todos cubiertos
- [x] **Sin placeholders:** todos los steps tienen código exacto o comandos exactos
- [x] **Consistencia de tipos:** al quitar FONDOS_ENABLED del schema Zod en Task 6, el TypeScript type `AppConfig` ya no tendrá esa prop — Task 5 elimina todas sus referencias antes, por lo que el orden Task 5 → Task 6 → Task 7 es obligatorio
- [x] **Orden de tasks:** Tasks 1-3 (deletes) → Tasks 4-6 (updates) → Task 7 (typecheck) → Task 8 (build) → Task 9 (análisis) → Task 10 (commit). El typecheck solo puede pasar cuando todas las referencias estén limpias.
- [x] **Fondos en log del scheduler:** el mensaje de arranque final también referencia `fondosCron` — Task 5 Steps 2 y 3 lo eliminan
