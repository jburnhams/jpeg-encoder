// Runs the ESM build in a real browser (Chromium via Playwright) and checks
// that the browser's own JPEG decoder accepts the output.
//
//   npx playwright install chromium   # once
//   npm run test:browser
//
// Set CHROMIUM_PATH to use an already installed Chromium instead.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>test</title>');
    return;
  }
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

try {
  const page = await browser.newPage();
  await page.goto(origin);

  const result = await page.evaluate(async () => {
    const { default: init, StreamingJpegEncoder, WasmColorType } = await import('/pkg/esm/index.js');
    const { makeImage, encodeInStrips } = await import('/test/helpers.js');
    await init();

    const width = 120;
    const height = 75;
    const rgba = makeImage(width, height, 4);
    const bytes = encodeInStrips(StreamingJpegEncoder, rgba, width, height, 4, WasmColorType.Rgba, 92, 10);

    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const decoded = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;

    let error = 0;
    for (let i = 0; i < decoded.length; i += 4) {
      for (let c = 0; c < 3; c++) error += Math.abs(decoded[i + c] - rgba[i + c]);
    }

    return { width: bitmap.width, height: bitmap.height, meanError: error / (width * height * 3) };
  });

  assert.equal(result.width, 120);
  assert.equal(result.height, 75);
  assert.ok(result.meanError < 3, `mean error ${result.meanError}`);
  console.log(`✓ browser decoded the streamed JPEG (mean error ${result.meanError.toFixed(2)})`);
} finally {
  await browser.close();
  server.close();
}
