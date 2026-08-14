import { readFileSync } from "fs";
import { resolve } from "path";

describe("contrato de migración operativa", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "../../supabase/migrations/20260813_operational_radars_watchdog.sql"),
    "utf8",
  );

  it("exige y conserva exactamente 12 filas radars sin INSERT ni DELETE", () => {
    expect(sql).toContain("IF before_count <> 12");
    expect(sql).toContain("IF after_count <> before_count OR after_count <> 12");
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.radars/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.radars/i);
  });

  it("versiona la semántica del match antes de reutilizar los slots", () => {
    const backfillPosition = sql.indexOf("SET radar_config_version_id = rcv.id");
    const slotUpdatePosition = sql.indexOf("SET name = 'CAPUFE — Nacional'");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.radar_config_versions");
    expect(sql).toContain("legacy_pre_20260813");
    expect(sql).toContain("operational_20260813");
    expect(sql).toContain("ALTER COLUMN radar_config_version_id SET NOT NULL");
    expect(sql).toContain("UNIQUE (radar_config_version_id, procurement_id)");
    expect(backfillPosition).toBeGreaterThan(-1);
    expect(slotUpdatePosition).toBeGreaterThan(backfillPosition);
  });

  it("activa cuatro slots existentes y no crea infraestructura de archivo Mac", () => {
    for (const key of [
      "capufe_oportunidades",
      "imss_morelos",
      "imss_bienestar_morelos",
      "habitat_morelos",
    ]) {
      expect(sql).toContain(`WHERE key = '${key}'`);
    }
    expect(sql).not.toContain("archive_jobs");
    expect(sql).not.toContain("archive_artifacts");
  });

  it("vincula snapshots por target sin borrarlos", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS target_id");
    expect(sql).toContain("UPDATE public.watchdog_snapshots ws");
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.watchdog_snapshots/i);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
  });
});
