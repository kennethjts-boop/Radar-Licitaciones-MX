import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('migrate-fase2a');

async function main() {
  log.info('🚀 Iniciando Migración Automatizada Fase 2A (Estrategia Incremental)...');

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    log.fatal('❌ SUPABASE_DB_URL no está configurado en el entorno local.');
    process.exit(1);
  }

  const migrationPath = path.resolve(__dirname, '../../../../docs/migrations/02_fase2a_incremental.sql');
  if (!fs.existsSync(migrationPath)) {
    log.fatal({ path: migrationPath }, '❌ Archivo de migración no encontrado');
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(migrationPath, 'utf8');

  log.info('Conectando a base de datos (Postgres real)...');
  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false }, 
    max: 1, 
    idle_timeout: 5 
  });

  try {
    log.info('Ejecutando sentencias SQL...');
    
    // Ejecutar statements. El postgres package permite queries crudas multi-statement fácilmente.
    const result = await sql.unsafe(sqlContent);
    // Nota: Como usamos IF NOT EXISTS, esto es idempotente y seguro de reintentar.

    log.info('✅ SQL ejecutado correctamente. La estructura está lista.');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.fatal({ err: errorMsg }, '❌ Falla crítica ejecutando SQL de migración');
    process.exit(1);
  } finally {
    log.info('Cerrando conexión DB...');
    await sql.end();
    log.info('🏁 Terminando script de migración.');
  }
}

main();
