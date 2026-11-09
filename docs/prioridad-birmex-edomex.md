# Focos de prioridad (versión `prioridad_20261108`)

Cuatro radares nuevos sobre el pipeline Edomex (misma cola `alerts`, `MAX_ALERTS_PER_CYCLE = 10`). Los 15 focos previos no cambian. Total: 19 activos.

| Clave | Criterio |
|---|---|
| `birmex_prioridad_20261108` | BIRMEX (siglas, razón social, UC `012NEF001`), cualquier giro/monto. **Sale primero** en la cola de entrega. |
| `edomex_difem_20261108` | DIFEM estatal. Excluye DIF municipales y SNDIF. |
| `edomex_jcem_20261108` | Toda convocatoria de la Junta de Caminos aunque no tenga monto; marca 🔥 si el monto explícito es > $100 MDP. Tiene precedencia sobre `edomex_carreteras`. |
| `edomex_salud_20261108` | ISEM y Secretaría de Salud del Estado de México (identifica el organismo en `matchedTerms`). Excluye ISSEMyM, IMSS y salud federal. |

- Matcher: `classifyPriorityProcurement` en `radars/edomex-focus.matcher.ts` (corre antes que la clasificación Edomex).
- Corte de publicación propio: 2026-10-09 (30 días); `publication_date` nula se considera elegible.
- Migración: `supabase/migrations/20261108_prioridad_radares.sql` (aplicar **antes** del despliegue; el guardado de matches falla si el radar no existe en BD).
- Montos sin publicar se muestran "por verificar"; nunca se afirma un monto.

## Conciliación única (SECOGEM)

Al primer ciclo Edomex tras el despliegue, `reconcilePriorityRows` evalúa contra los focos nuevos las filas del índice ya conocidas y detectadas después del archivo histórico (≥ 2026-10-26). Sello: `system_state.edomex_priority_backfill_v1:<slug>`. Respeta vencimiento y el tope de 10 alertas por ciclo (BIRMEX primero); los matches se guardan siempre.
