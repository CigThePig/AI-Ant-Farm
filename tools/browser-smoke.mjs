// Browser integration checks run in CI with real Chromium. They cover rendering,
// controls, report download, resize, and actual pointer/touch dispatch.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const artifactDir = 'test-artifacts';
await mkdir(artifactDir, { recursive: true });
const server = spawn(process.execPath, ['tools/serve.mjs'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, PORT: '8080' },
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('http://localhost')) resolve();
    });
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`Preview server exited: ${code}`)));
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const results = [];
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 2340, height: 1080 },
    { width: 1024, height: 768 },
    { width: 888, height: 400 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      hasTouch: true,
      deviceScaleFactor: 1,
      recordVideo: { dir: `${artifactDir}/video`, size: { width: 1280, height: 720 } },
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('http://localhost:8080');
    await page.waitForFunction(() => !!window.antFarm);
    await page.getByRole('button', { name: 'Pause simulation' }).click();
    assert.equal(await page.evaluate(() => window.antFarm.paused), true);
    await page.getByRole('button', { name: 'Controls' }).click();
    await page.getByLabel('World seed').fill('1337');
    await page.getByRole('button', { name: 'Start a new colony' }).click();
    assert.equal(await page.evaluate(() => window.antFarm.snapshot().seed), 1337);
    const before = await page.evaluate(() => window.antFarm.snapshot().time);
    await page.getByRole('button', { name: 'Step', exact: true }).click();
    assert.ok((await page.evaluate(() => window.antFarm.snapshot().time)) > before);
    await page.getByLabel('Locomotion sensitivity').press('End');
    assert.equal(await page.evaluate(() => window.antFarm.simulation.p.walkMMPerSecond), 2);
    await page.getByLabel('Locomotion sensitivity').press('Home');
    for (let i = 0; i < 3; i++) await page.getByLabel('Locomotion sensitivity').press('ArrowRight');
    await page.getByLabel('Trail response and deposition').uncheck();
    assert.equal(await page.evaluate(() => window.antFarm.simulation.p.trailsEnabled), false);
    await page.getByLabel('Trail response and deposition').check();
    await page.getByRole('button', { name: 'Start a new colony' }).click();
    // Exercise the engine in the actual browser, then observe a rendered frame.
    await page.evaluate(() => {
      const sim = window.antFarm.simulation;
      for (let i = 0; i < 3600; i++) sim.step();
    });
    await page.waitForFunction(
      () => document.getElementById('phase').textContent === 'ESTABLISHED',
    );
    const snap = await page.evaluate(() => window.antFarm.snapshot());
    assert.equal(snap.metrics.births, 0);
    assert.ok(snap.metrics.gathered > 0);
    assert.deepEqual(await page.evaluate(() => window.antFarm.inspect()), []);
    await page.evaluate(() => {
      window.antFarm.renderer.selected = window.antFarm.simulation.ants[1].id;
    });
    await page.waitForFunction(() => !document.getElementById('selection').hidden);
    assert.match(await page.locator('#selection').textContent(), /Local cues/);
    await page.getByRole('button', { name: 'Erase surface trails' }).click();
    assert.equal(
      await page.evaluate(() => window.antFarm.simulation.world.trail.reduce((a, b) => a + b, 0)),
      0,
    );
    await page.getByText('Experimental feeder', { exact: true }).click();
    const imports = await page.evaluate(() => window.antFarm.snapshot().ledger.inputs);
    await page.getByRole('button', { name: 'Provision entrance feeder', exact: true }).click();
    const afterProvision = await page.evaluate(() => window.antFarm.snapshot().ledger.inputs);
    assert.equal(afterProvision.c - imports.c, 1000);
    assert.equal(afterProvision.p - imports.p, 200);
    assert.deepEqual(await page.evaluate(() => window.antFarm.inspect()), []);
    await page.getByLabel('View layer').selectOption('tasks');
    await page.getByText('Colony diagnostics', { exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download colony report' }).click();
    const download = await downloadPromise;
    await download.saveAs(`${artifactDir}/report-${viewport.width}.json`);
    await page.getByRole('button', { name: 'Close controls' }).click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('selection').hidden);
    // Pan with a real mouse and verify the camera changed.
    const oldX = await page.evaluate(() => window.antFarm.renderer.camera.x);
    const y = Math.min(viewport.height * 0.6, viewport.height - 100),
      x = viewport.width * 0.65;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 50, y + 15, { steps: 5 });
    await page.mouse.up();
    assert.notEqual(await page.evaluate(() => window.antFarm.renderer.camera.x), oldX);
    const oldZoom = await page.evaluate(() => window.antFarm.renderer.camera.zoom);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 35, y },
        { x: x + 35, y },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 65, y },
        { x: x + 65, y },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok((await page.evaluate(() => window.antFarm.renderer.camera.zoom)) > oldZoom);
    await page.getByRole('button', { name: 'Colony', exact: false }).first().click();
    await page.screenshot({
      path: `${artifactDir}/colony-${viewport.width}x${viewport.height}.png`,
    });
    await page.getByRole('button', { name: 'Controls' }).click();
    await page.getByLabel('View layer').selectOption('food');
    await page.getByRole('button', { name: 'Close controls' }).click();
    await page.screenshot({
      path: `${artifactDir}/trail-${viewport.width}x${viewport.height}.png`,
    });
    assert.equal(await page.locator('#fatal').isVisible(), false);
    assert.deepEqual(errors, []);
    results.push({ viewport, snapshot: snap, errors });
    await context.close();
  }
  await writeFile(`${artifactDir}/browser-results.json`, JSON.stringify(results, null, 2));
  console.log(
    `Browser smoke passed on ${results.length} viewports; screenshots and video in ${artifactDir}/.`,
  );
} finally {
  await browser?.close();
  server.kill();
}
