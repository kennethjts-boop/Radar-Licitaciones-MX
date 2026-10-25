# Estado de México en el flujo del radar

Desde la versión `edomex_20261025` el Estado de México ya no es un canal paralelo: sus procedimientos se guardan en `procurements`, se evalúan con radares registrados en `radars`/`radar_config_versions`, generan `matches` versionados y entran a la misma cola `alerts` (`new_match`, `dedupe_key = new_match:<procurement>`) que ComprasMX. Los once focos de CAPUFE/IMSS se conservan sin cambios (15 radares activos).

## Radares (migración `20261025_edomex_radares.sql`)

| Clave | Criterio |
|---|---|
| `edomex_issemym_20261025` | ISSEMyM: cualquier licitación nueva, cualquier giro y monto. |
| `edomex_carreteras_20261025` | Carreteras: monto explícito > $100 MDP. Prioriza rehabilitación, conservación, pavimentación y bacheo. Sin monto: sólo alcance regional/carretero y como candidata pendiente. |
| `edomex_sitramytem_20261025` | SITRAMyTEM: trabajos viales y mantenimiento acotado. Trabajo carretero conserva el mínimo de $100 MDP. |
| `edomex_oportunidades_20261025` | Otras dependencias estatales y municipios: obras, tecnología, equipamiento, vehículos, limpieza, seguridad y suministros desde $20 MDP; sin monto, sólo alcance amplio y como candidata pendiente. |

Exclusiones (salvo ISSEMyM): concesiones, llave en mano, teleféricos, viaductos, túneles, proyectos integrales de líneas Mexibús/Mexicable, APP. Lógica: `apps/worker/src/radars/edomex-focus.matcher.ts`.

## Fuentes

- **SECOGEM** (fuente `secogem_edomex`): índices de obra pública y bienes/servicios, cada 30 min (`modules/edomex/job.ts`). Lectura HTTP pública, sin navegador.
- **ComprasMX**: los mismos radares evalúan los procedimientos de unidades compradoras estatales (`915xxxxxx`) y municipales (`815xxxxxx` / siglas `074xxx`) del Estado de México, además de ISSEMyM, SITRAMyTEM y JCEM. Las dependencias federales ubicadas en el estado (IMSS, SICT, AIFA…) no cuentan.

## Montos

Sólo cuenta el presupuesto o monto explícito del contrato. Capital contable, costo de bases e inversión global de un programa nunca se usan. Sin monto confirmado el match es `medium` y la alerta dice "candidata pendiente de revisión". Una convocatoria que agrupa varios procedimientos se guarda como un `procurement` por número (`secogem:<número>`) y ninguno recibe el presupuesto conjunto (`monto_estado = convocatoria_agrupada`).

## Fechas, histórico y deduplicación

- `publication_date` sólo se llena con una columna rotulada como publicación en el índice; si no existe queda `NULL`. La primera detección es `procurements.created_at` y `raw_json.primera_deteccion`. La alerta muestra ambas por separado.
- La línea base existente (`edomex_index:*`, misma identidad número|PDF que PR #63) marca el archivo histórico. Ese histórico se normaliza una sola vez (`edomex_backfill_v1:*`) sin matches ni alertas, para que un procedimiento que reaparezca en otro PDF no se presente como nuevo.
- Sólo filas añadidas después de la línea base y procedimientos nuevos en BD generan match/alerta, una por convocatoria. Además, ningún foco Edomex alerta publicaciones anteriores al 2026-10-25.
- La entrega usa la cola común con `MAX_ALERTS_PER_CYCLE = 10` y un lock (`new-tender-delivery`) compartido con el ciclo ComprasMX.

## Vigilancia (consentimiento individual)

Tras entregar la alerta se pregunta "¿Vigilar? Sí / No":

- **SECOGEM**: sólo compara el hash del PDF de la convocatoria (`edomex_watch:<procurement>` en `system_state`). No vigila bases, anexos, juntas, actas, fallos ni otros portales. Botones `edw:yes|no|stop:<uuid>` o respuesta sí/no.
- **ComprasMX**: watchdog existente (documentos, fechas, partidas).

Sin Sí persistido no se descarga el PDF. Una solicitud se envía una sola vez; un No es definitivo y la conciliación no reactiva históricos.

## Pausas y modos

`/pausa collector` o global detiene el descubrimiento estatal; `/pausa watchdog` detiene la comparación de PDFs; `watchdog_only` sólo compara PDFs ya autorizados.

## Verificación productiva

- `radars`: 15 activos; `radar_config_versions` vigentes: 11 `operational_20261014` + 4 `edomex_20261025`.
- `collect_runs` con `collector_key = 'secogem_edomex'` y `system_state.edomex_last_run` con conteos por página o errores explícitos.
- `procurements` con la fuente `secogem_edomex` (`raw_json.historical_baseline = true` para el archivo).
