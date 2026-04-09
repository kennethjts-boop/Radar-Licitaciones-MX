/**
 * COLLECT RUN REPOSITORY — Registro de ciclos de colección.
 */
import { v4 as uuidv4 } from 'uuid';
import { getSupabaseClient } from './client';
import { StorageError } from '../core/errors';
import { nowISO } from '../core/time';
import type { DbCollectRun } from '../types/database';
import type { CollectRunResult } from '../types/procurement';

export async function startCollectRun(
  sourceId: string,
  collectorKey: string
): Promise<string> {
  const db = getSupabaseClient();
  const id = uuidv4();

  const record: DbCollectRun = {
    id,
    source_id: sourceId,
    collector_key: collectorKey,
    started_at: nowISO(),
    finished_at: null,
    status: 'running',
    items_seen: 0,
    items_created: 0,
    items_updated: 0,
    error_message: null,
    metadata_json: null,
  };

  const { error } = await db.from('collect_runs').insert(record);
  if (error) {
    throw new StorageError(`Error iniciando collect_run: ${error.message}`, 'start_run');
  }

  return id;
}

export async function finishCollectRun(
  runId: string,
  result: Omit<CollectRunResult, 'collectorKey' | 'sourceId' | 'startedAt'>
): Promise<void> {
  const db = getSupabaseClient();

  const { error } = await db
    .from('collect_runs')
    .update({
      finished_at: result.finishedAt,
      status: result.status,
      items_seen: result.itemsSeen,
      items_created: result.itemsCreated,
      items_updated: result.itemsUpdated,
      error_message: result.errorMessage,
      metadata_json: result.metadata,
    })
    .eq('id', runId);

  if (error) {
    throw new StorageError(`Error finalizando collect_run: ${error.message}`, 'finish_run');
  }
}

export async function getLastCollectRun(collectorKey: string): Promise<DbCollectRun | null> {
  const { data, error } = await getSupabaseClient()
    .from('collect_runs')
    .select('*')
    .eq('collector_key', collectorKey)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new StorageError(`Error obteniendo último run: ${error.message}`, 'get_last');
  }
  return data ?? null;
}
