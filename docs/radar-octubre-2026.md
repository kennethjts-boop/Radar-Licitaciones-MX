# Radar operativo desde el 14 de octubre de 2026

La rama `feat/radar-octubre-2026` define once focos nuevos para convocatorias de ComprasMX. El corte de alerta es **2026-10-14 00:00 America/Mexico_City** y exige la fecha oficial de publicación. La fecha de apertura, modificación, consulta y primer descubrimiento no sustituyen esa fecha.

| Dependencia | Foco | Clave |
| --- | --- | --- |
| CAPUFE | Seguridad y vigilancia presencial | `capufe_seguridad_20261014` |
| CAPUFE | Vehículos de emergencia y auxilio vial | `capufe_emergencia_vehiculos_20261014` |
| CAPUFE | Vehículos administrativos | `capufe_vehiculos_administrativos_20261014` |
| CAPUFE | Limpieza integral general | `capufe_limpieza_general_20261014` |
| CAPUFE | Mobiliario y equipamiento | `capufe_mobiliario_20261014` |
| CAPUFE | Limpieza especial de cobertura nacional | `capufe_limpieza_especial_nacional_20261014` |
| IMSS | Limpieza | `imss_limpieza_20261014` |
| IMSS | Seguridad y vigilancia presencial | `imss_seguridad_20261014` |
| IMSS | Estudios de laboratorio clínico | `imss_laboratorio_clinico_20261014` |
| IMSS | Banco de sangre | `imss_banco_sangre_20261014` |
| IMSS | Toda nueva convocatoria de la unidad 050GYR085 | `imss_bienestar_morelos` |

La clave histórica de Oaxtepec se conserva para mantener sus relaciones. Su versión vigente pasa a `operational_20261014`; las versiones y matches previos no se modifican. Las otras diez claves son nuevas. La migración guarda un snapshot de `radars`, cierra las versiones activas anteriores y deja exactamente once radares activos. El matcher en código usa las mismas claves, y el repositorio exige la versión de octubre antes de guardar un match.

## Activación productiva, pendiente de aprobación

1. Revisar y aprobar el PR. Pausar el worker de colección durante la transición para evitar que el código y la configuración de BD queden desfasados.
2. Respaldar la BD por el procedimiento habitual. Revisar `supabase migration list --linked` y confirmar que la única migración pendiente es `20261015011907_radar_octubre_2026.sql`; aplicar **sólo entonces** con `supabase db push` en el proyecto vinculado. No se ha aplicado desde esta rama.
3. Verificar en lectura: `select key, is_active from public.radars where is_active order by key;` debe devolver once filas; `select r.key, v.version_key from public.radars r join public.radar_config_versions v on v.radar_id = r.id and v.effective_to is null where r.is_active;` debe devolver once veces `operational_20261014`. Verificar que la clave `imss_bienestar_morelos` está activa.
4. Desplegar el worker del commit aprobado y reanudar la colección. Revisar una corrida de listado, la recuperación de fecha oficial en candidatos, el conteo de matches y la cola de `new_match`. Ejecutar `npm run radar-focus:dry-run` localmente con variables de entorno de prueba antes de desplegar.

El listado ComprasMX sólo entrega procedimientos con estatus vigente y no incluye la fecha de publicación en la respuesta normal. El worker la lee del cronograma del expediente antes de alertar; si no puede verificarla, conserva el match y no envía alerta. El scan cubre como máximo `COMPRASMX_MAX_LIST_PAGES` páginas (20 por defecto) y no garantiza hallar procedimientos fuera de ese rango o ausentes del índice vigente. Los expedientes idénticos ya conocidos que sigan dentro del rango se reevalúan cuando encajan en un foco y carecen de match de la versión de octubre; los anteriores al corte se descartan mediante la fecha oficial. No hay garantía de cobertura exhaustiva del portal.
