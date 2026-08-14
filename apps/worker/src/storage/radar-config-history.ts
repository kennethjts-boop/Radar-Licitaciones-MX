export interface EmbeddedRadarConfigVersion {
  radar_key: string;
  radar_name: string;
}

export interface VersionedMatchRow {
  radar_config_versions: EmbeddedRadarConfigVersion | null;
}

/**
 * La presentación de un match siempre se resuelve desde la versión enlazada al
 * match, nunca desde el slot mutable de `radars`.
 */
export function resolveHistoricalRadarContext(row: VersionedMatchRow): {
  key: string;
  name: string;
} | null {
  const version = row.radar_config_versions;
  if (!version) return null;
  return { key: version.radar_key, name: version.radar_name };
}
