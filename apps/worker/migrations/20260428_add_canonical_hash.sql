-- Migración: añadir canonical_hash a procurements para deduplicación cross-ID
-- Hash SHA-256 de (numero_procedimiento || '|' || expediente_id) en lowercase/trim.
-- Permite detectar duplicados aunque el external_id interno de ComprasMX cambie.

-- 1. Agregar columna
ALTER TABLE procurements
  ADD COLUMN IF NOT EXISTS canonical_hash TEXT;

-- 2. Backfill con MD5 de external_id + expediente_id (aproximación; SHA-256 se aplicará desde el worker)
--    Usamos MD5 como proxy para el backfill porque Postgres no tiene sha256 built-in sin pgcrypto.
--    Los registros con el nuevo worker obtendrán el SHA-256 real en el siguiente ciclo.
UPDATE procurements
SET canonical_hash = MD5(
  LOWER(TRIM(COALESCE(procedure_number, ''))) || '|' ||
  LOWER(TRIM(COALESCE(expediente_id, '')))
)
WHERE canonical_hash IS NULL;

-- 3. Índice único (excluye NULLs automáticamente en Postgres)
CREATE UNIQUE INDEX IF NOT EXISTS procurements_canonical_hash_idx
  ON procurements (canonical_hash)
  WHERE canonical_hash IS NOT NULL;
