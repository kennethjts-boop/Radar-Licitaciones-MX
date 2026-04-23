import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

puppeteer.use(StealthPlugin());

async function run() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1280, height: 800 });
  console.log("Navigating to PNT...");
  
  await page.goto('https://consultapublicamx.plataformadetransparencia.org.mx/vut-web/', { waitUntil: 'networkidle2', timeout: 60000 });
  
  console.log("Page title:", await page.title());
  
  // Wait a bit to let Cloudflare Turnstile potentially resolve (sometimes stealth does it automatically)
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log("After 5s title:", await page.title());
  await page.screenshot({ path: 'pnt_after_5s.png', fullPage: true });
  
  fs.writeFileSync('pnt_page.html', await page.content());
  
  await browser.close();
  console.log("Done");
}

run().catch(console.error);
