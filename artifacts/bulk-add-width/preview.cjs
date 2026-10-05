// Repeatable browser capture; run from the repository root after npm run build.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const folder = path.resolve('artifacts/bulk-add-width');
  const server = spawn('.venv/bin/python', ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', '8011'], {
    env: { ...process.env, ESTIMATOR_DB: path.join(folder, 'preview.sqlite3') }, stdio: 'ignore',
  });
  let browser;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch('http://127.0.0.1:8011/api/health')).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1512, height: 1050 } });
    await page.goto('http://127.0.0.1:8011');
    await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
    await page.getByRole('button', { name: 'Bulk add', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Set up your agent suite' });
    await dialog.waitFor();
    const captures = [];
    for (const [name, width, height] of [['desktop', 1512, 1050], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: path.join(folder, `${name}.png`), fullPage: true });
      const geometry = await dialog.evaluate(element => ({
        width: element.getBoundingClientRect().width,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        fields: [...element.querySelectorAll('.quick-volume-group .field > span')].map(label => {
          const range = document.createRange(); range.selectNodeContents(label);
          return { name: label.textContent, lines: new Set([...range.getClientRects()].map(rect => rect.top)).size };
        }),
      }));
      captures.push({ viewport: { width, height }, screenshot: `${name}.png`, ...geometry });
      if (name === 'mobile') {
        await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await page.screenshot({ path: path.join(folder, 'mobile-bottom.png'), fullPage: true });
      }
    }
    await fs.writeFile(path.join(folder, 'layout-report.json'), JSON.stringify({
      command: 'node artifacts/bulk-add-width/preview.cjs', captures,
    }, null, 2));
    console.log(JSON.stringify(captures));
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
