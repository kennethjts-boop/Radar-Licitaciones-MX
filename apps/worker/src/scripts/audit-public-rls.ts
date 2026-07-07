import "dotenv/config";
import process from "process";
import postgres from "postgres";

type RlsFinding = {
  schema: string;
  table: string;
  rls_enabled: boolean;
};

type GrantFinding = {
  table_name: string;
  grantee: string;
  privilege_type: string;
};

async function main(): Promise<void> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("SUPABASE_DB_URL is required for direct RLS audit.");
    process.exit(1);
  }

  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    max: 1,
    idle_timeout: 5,
  });

  try {
    const rlsFindings = await sql<RlsFinding[]>`
      SELECT
        n.nspname AS schema,
        c.relname AS table,
        c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relrowsecurity = false
      ORDER BY c.relname;
    `;

    const grantFindings = await sql<GrantFinding[]>`
      SELECT
        g.table_name,
        g.grantee,
        g.privilege_type
      FROM information_schema.role_table_grants g
      JOIN information_schema.tables t
        ON t.table_schema = g.table_schema
       AND t.table_name = g.table_name
      WHERE g.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND g.grantee IN ('anon', 'authenticated')
      ORDER BY g.table_name, g.grantee, g.privilege_type;
    `;

    if (rlsFindings.length > 0 || grantFindings.length > 0) {
      if (rlsFindings.length > 0) {
        console.error("Public tables with RLS disabled:");
        for (const finding of rlsFindings) {
          console.error(`  - ${finding.schema}.${finding.table}`);
        }
      }

      if (grantFindings.length > 0) {
        console.error("Direct public grants on base tables:");
        for (const finding of grantFindings) {
          console.error(
            `  - public.${finding.table_name}: ${finding.grantee} ${finding.privilege_type}`,
          );
        }
      }

      process.exit(1);
    }

    console.log(
      "RLS audit passed: all public base tables have RLS enabled and no direct anon/authenticated table grants remain.",
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`RLS audit failed: ${message}`);
  process.exit(1);
});
