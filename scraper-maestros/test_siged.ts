import puppeteer from 'puppeteer';
import fs from 'fs';

async function run() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  console.log("Navigating to SIGED...");
  await page.goto('https://www.siged.sep.gob.mx/SIGED/escuelas.html', { waitUntil: 'networkidle2' });
  
  console.log("Setting State to Morelos (17)");
  await page.select('#entidad', '17'); // Morelos is usually 17
  
  console.log("Setting Nivel to TELESECUNDARIA");
  await page.select('#nivel', 'TELESECUNDARIA');
  
  console.log("Clicking Search...");
  await page.click('#btnBuscarEscuela');
  
  console.log("Waiting for DataTable...");
  try {
    await page.waitForSelector('#tablaEscuelas tbody tr', { timeout: 15000 });
  } catch (err) {
    console.log("Timeout waiting for table");
  }
  
  const html = await page.content();
  fs.writeFileSync('siged_search.html', html);
  await page.screenshot({ path: 'siged_search.png', fullPage: true });
  
  await browser.close();
  console.log("Done. Check siged_search.png");
}

run().catch(console.error);
