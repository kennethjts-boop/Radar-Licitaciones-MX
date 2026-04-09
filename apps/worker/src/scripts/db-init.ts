/**
 * DB INIT — Script para inicializar tablas de Supabase en Phase 1A.
 *
 * Utiliza conexion directa de PostgreSQL usando SUPABASE_DB_URL
 * ya que la API REST no permite DDL (CREATE TABLE).
 */
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { getConfig } from '../config/env';

async function run() {
  console.log('🚀 Iniciando script de inicialización de base de datos...');

  const config = getConfig();
  const dbUrl = config.SUPABASE_DB_URL;

  if (!dbUrl) {
    console.error('💥 ERROR FATAL: SUPABASE_DB_URL no está configurada.');
    console.error('Este script requiere conexión directa a Postgres para poder ejecutar CREATE TABLE.');
    console.error('Configúrala en .env. (ej. postgresql://postgres.xxxx:password@aws-0-....)');
    process.exit(1);
  }

  // Leer el sql file
  const schemaPath = path.resolve(__dirname, '../../../../docs/supabase-schema.sql');
  console.log(`📁 Loading schema from ${schemaPath}`);
  
  if (!fs.existsSync(schemaPath)) {
    console.error(`💥 ERROR: No se encontró el archivo de schema en: ${schemaPath}`);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(schemaPath, 'utf8');

  console.log('🔌 Connecting to database...');
  // Configuro a ssl: 'require' para Supabase cloud.
  // Múltiples statements son compatibles por defecto si usamos postgresjs raw o unsafe.
  const sql = postgres(dbUrl, { ssl: 'require', max: 1 });

  try {
    console.log('⚙️ Executing schema...');
    
    // postgresjs usa simple query protocol por defecto para unsafe y soporta múltiples statements.
    await sql.unsafe(sqlContent);
    
    console.log('✅ Schema execution completed');
    console.log('✅ Tables created/verified');
    console.log('✅ Database initialization successful');
    
  } catch (err) {
    console.error('💥 ERROR ejecutando el schema SQL:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

run().catch((err) => {
  console.error('💥 Fatal error in db:init:', err);
  process.exit(1);
});
