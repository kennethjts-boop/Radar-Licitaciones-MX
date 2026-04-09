import "dotenv/config";
import { BrowserManager } from "../apps/worker/src/collectors/comprasmx/browser.manager";
import { ComprasMxNavigator } from "../apps/worker/src/collectors/comprasmx/comprasmx.navigator";
import { downloadAttachments } from "../apps/worker/src/collectors/comprasmx/attachment-downloader";
import { collectComprasMx } from "../apps/worker/src/collectors/comprasmx/comprasmx.collector";
import {
  getExistingAttachmentFileNames,
  insertStoredAttachment,
  upsertProcurement,
} from "../apps/worker/src/storage/procurement.repo";
import { getSupabaseClient } from "../apps/worker/src/storage/client";
import { uploadTenderFile } from "../apps/worker/src/storage/tender-document.storage";

async function run() {
  const externalId = process.argv[2];
  if (!externalId) {
    throw new Error("Uso: npx ts-node scripts/test_download.ts \"ID_LICITACION\"");
  }

  console.log(`Buscando licitación ${externalId} en el listado...`);
  const collect = await collectComprasMx({ maxPages: 2 });
  const item = collect.items.find((x) => x.externalId === externalId);
  if (!item) {
    throw new Error(
      `No se encontró ${externalId} en las páginas escaneadas. pages=${collect.pagesScanned}`,
    );
  }

  const db = getSupabaseClient();
  const { data: source } = await db
    .from("sources")
    .select("id")
    .eq("key", "comprasmx")
    .single();
  if (!source?.id) {
    throw new Error("No se encontró source id para comprasmx");
  }

  const upsert = await upsertProcurement(item, source.id);
  console.log("Registro procurement OK:", upsert.procurementId);

  await BrowserManager.withContext(async (page, context) => {
    const navigator = new ComprasMxNavigator();
    console.log("Navegando al detalle...");
    const detail = await navigator.extractDetail(context, item.sourceUrl, page);
    if (!detail) throw new Error("No se pudo abrir el detalle de la licitación");

    const existingFileNames = await getExistingAttachmentFileNames(
      upsert.procurementId,
    );
    console.log(`Evaluando archivos... existentes=${existingFileNames.size}`);

    const files = await downloadAttachments(
      page,
      upsert.procurementId,
      existingFileNames,
    );

    for (const file of files) {
      console.log(`Archivo detectado: ${file.fileName}`);
      if (existingFileNames.has(file.fileName)) {
        console.log(`Archivo ${file.fileName} ya existe en DB, ignorando`);
        continue;
      }
      console.log("Descarga Playwright OK");
      const uploaded = await uploadTenderFile(
        upsert.procurementId,
        file.fileName,
        file.tempFilePath,
        file.fileType,
      );
      console.log("Subida Supabase OK:", uploaded.storagePath);
      await insertStoredAttachment({
        procurementId: upsert.procurementId,
        fileName: uploaded.fileName,
        storagePath: uploaded.storagePath,
        fileType: file.fileType,
        fileSizeBytes: uploaded.fileSizeBytes,
        fileHash: uploaded.fileHash,
      });
      console.log("Registro DB OK");
      console.log("Archivo temporal eliminado");
    }
  });
}

run().catch((err) => {
  console.error("❌ test_download falló:", err);
  process.exit(1);
});
