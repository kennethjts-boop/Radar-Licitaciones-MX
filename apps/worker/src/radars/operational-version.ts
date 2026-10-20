/**
 * OPERATIONAL RADAR VERSION — fuente única de verdad de la versión de
 * configuración vigente de los radares operativos (once focos de octubre 2026).
 *
 * Antes esta cadena ("operational_20261014") estaba repetida en varios módulos
 * (match-alert.repo, comprasmx.collector, licitacion-watchdog/auto-activation).
 * Cada copia era un punto de falla: si la migración de octubre se actualizaba y
 * sólo se corrigiera una de las copias, `upsertMatch` empezaba a lanzar
 * `StorageError` y las alertas de los once focos se detenían en silencio.
 *
 * La clave debe coincidir con `radar_config_versions.version_key` sembrado en
 * `supabase/migrations/20261015011907_radar_octubre_2026.sql`.
 */
export const OPERATIONAL_RADAR_VERSION_KEY = "operational_20261014";
