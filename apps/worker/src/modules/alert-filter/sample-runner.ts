/**
 * Ejecuta el filtro de alertas contra 250 licitaciones simuladas e imprime métricas.
 * No requiere DB ni Telegram. Ejecutar con: npm run alert-filter:sample
 */
import { generateSampleData } from './sample-data';
import { classifyAlert } from './eligibility';
import type { AlertFilterOptions, CycleMetrics } from './types';

const OPTIONS: AlertFilterOptions = {
  desertaLookbackDays: 10,
  activeMaxAgeDays: 21,
};

const ALERT_MAX_PER_CYCLE = 25;

function run(): void {
  const entries = generateSampleData();
  const seenIds = new Set<string>();

  const metrics: CycleMetrics = {
    found: entries.length,
    alertable: 0,
    sent: 0,
    excluded: 0,
    excludedClosed: 0,
    excludedOld: 0,
  };

  let excludedDuplicates = 0;

  for (const { item, upsertResult, category } of entries) {
    // Dedup por externalId
    if (seenIds.has(item.externalId)) {
      excludedDuplicates++;
      continue;
    }
    seenIds.add(item.externalId);

    const classification = classifyAlert(item, upsertResult, OPTIONS);

    if (classification.decision === 'NOT_ALERTABLE') {
      metrics.excluded++;
      const closedReasons = ['old_closed_status', 'new_but_closed', 'new_but_awarded', 'new_but_cancelled', 'new_but_expired'];
      if (closedReasons.includes(classification.reason)) {
        metrics.excludedClosed++;
      } else {
        metrics.excludedOld++;
      }
      continue;
    }

    metrics.alertable++;

    if (metrics.sent < ALERT_MAX_PER_CYCLE) {
      metrics.sent++;
    }
  }

  console.log('\n📊 RESULTADO alert-filter:sample');
  console.log('─────────────────────────────────');
  console.log(`found:              ${metrics.found}`);
  console.log(`alertable:          ${metrics.alertable}`);
  console.log(`sent (capped):      ${metrics.sent}  (límite: ${ALERT_MAX_PER_CYCLE})`);
  console.log(`excluded total:     ${metrics.excluded}`);
  console.log(`  excludedClosed:   ${metrics.excludedClosed}`);
  console.log(`  excludedOld:      ${metrics.excludedOld}`);
  console.log(`excludedDuplicates: ${excludedDuplicates}`);
  console.log('─────────────────────────────────');

  const ok = (cond: boolean, msg: string) => {
    if (!cond) { console.error(`❌ FALLO: ${msg}`); process.exit(1); }
    console.log(`✅ ${msg}`);
  };

  ok(metrics.found === 250, `found === 250 (got ${metrics.found})`);
  ok(metrics.sent <= ALERT_MAX_PER_CYCLE, `sent <= ${ALERT_MAX_PER_CYCLE}`);
  ok(metrics.excludedClosed > 0, 'excludedClosed > 0');
  ok(metrics.excludedOld > 0, 'excludedOld > 0');
  ok(excludedDuplicates > 0, 'excludedDuplicates > 0');
  ok(metrics.alertable <= 60, `alertable razonable (got ${metrics.alertable})`);

  console.log('\n🏁 Sample runner completado sin errores.\n');
}

run();
