/**
 * Smoke test aislado del listado ComprasMX.
 *
 * No escribe en Supabase ni envía mensajes a Telegram.
 * Uso: npm run comprasmx:smoke
 */
import "dotenv/config";

async function main(): Promise<void> {
  process.env.SUPABASE_URL ??= "https://smoke.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "smoke-not-used";
  process.env.TELEGRAM_BOT_TOKEN ??= "000000000:SMOKE_NOT_USED";
  process.env.TELEGRAM_CHAT_ID ??= "smoke-not-used";

  const { BrowserManager } = await import("../collectors/comprasmx/browser.manager");
  const { ComprasMxNavigator } = await import("../collectors/comprasmx/comprasmx.navigator");
  const { withComprasMxCleanSessionRetry } = await import(
    "../collectors/comprasmx/comprasmx.failure"
  );
  const { getConfig } = await import("../config/env");
  const config = getConfig();
  const outcome = await withComprasMxCleanSessionRetry((forceBrowser) =>
    BrowserManager.withContext(async (page) => {
      const navigator = new ComprasMxNavigator();
      return navigator.scanListing(
        page,
        config.COMPRASMX_SEED_URL,
        1,
        { forceBrowser },
      );
    }),
  );

  const result = outcome.value;
  console.log(JSON.stringify({
    status: result.status,
    rows: result.rows.length,
    pagesScanned: result.pagesScanned,
    retryPerformed: outcome.retryPerformed,
    recoveredFromTransient401: outcome.recoveredFromTransient401,
    failureDiagnosis: result.failureDiagnosis ?? null,
    unavailableReason: result.unavailableReason ?? null,
  }, null, 2));

  if (
    result.status !== "success" &&
    result.status !== "empty_result"
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
