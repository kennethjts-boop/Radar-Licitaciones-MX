import puppeteer from 'puppeteer';
async function run() {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('https://www.siged.sep.gob.mx/SIGED/escuelas.html', { waitUntil: 'networkidle2' });
  console.log("Page loaded. Title:", await page.title());
  await browser.close();
}
run();
