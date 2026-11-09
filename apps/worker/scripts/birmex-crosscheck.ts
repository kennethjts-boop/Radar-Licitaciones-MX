/**
 * Cruce directo de BIRMEX con ComprasMX usando la firma del colector (sólo lectura).
 * Uso: npx ts-node scripts/birmex-crosscheck.ts
 */
import { searchComprasMxProcedimientos } from "../src/collectors/comprasmx/comprasmx.navigator";

async function main(): Promise<void> {
  const variants: Array<[string, Record<string, unknown>]> = [
    ["UC 012NEF001 (todos los estatus)", { numero_procedimiento: "012NEF001" }],
    ["UC 012NEF001 (estatus vigente)", { numero_procedimiento: "012NEF001", estatus_alterno: ["VIGENTE"] }],
    ["texto BIRMEX", { nombre_procedimiento: "BIRMEX" }],
    ["compra consolidada vigente", { compra_consolidada: true }],
  ];
  for (const [label, filter] of variants) {
    try {
      const result = await searchComprasMxProcedimientos(filter, 6);
      const birmex = result.registros.filter((r) => /birmex|012NEF001/i.test(JSON.stringify(r)));
      console.log(`\n# ${label}: total=${result.total} leídos=${result.registros.length} BIRMEX=${birmex.length}`);
      for (const r of birmex) {
        console.log(`${r.numero_procedimiento} | ${r.estatus} | apertura ${r.fecha_apertura} | monto ${r.monto ?? "n/d"} | ${String(r.nombre_procedimiento).slice(0, 70)}`);
      }
    } catch (err) {
      console.log(`\n# ${label}: ERROR ${(err as Error).message.slice(0, 160)}`);
    }
  }
}
void main();
