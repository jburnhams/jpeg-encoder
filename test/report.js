// Visual report: encodes the test pattern with every case in test/cases.js and
// writes report/index.html with the source, each JPEG, an amplified
// difference image, file size and PSNR, for checking output by eye.
//
//   npm run build && npm run report
//   open report/index.html
//
// CI uploads the report as a build artifact.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';

import init, { encodeJpeg, WasmColorType } from 'jpeg-encoder-wasm';
import { goldenCases } from './cases.js';
import { makeTestPattern, psnr } from './helpers.js';

await init();

const width = 256;
const height = 256;
const outDir = new URL('../report/', import.meta.url);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal RGBA PNG encoder */
function png(rgba, w, h) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);

  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  header.set([8, 6, 0, 0, 0], 8);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Absolute RGB difference, amplified 8x */
function diffImage(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.abs(a[i + c] - b[i + c]) * 8);
    out[i + 3] = 255;
  }
  return out;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const source = makeTestPattern(width, height);
writeFileSync(new URL('source.png', outDir), png(source, width, height));

const rows = [];
for (const { name, options } of goldenCases) {
  const bytes = encodeJpeg(source, width, height, WasmColorType.Rgba, options);
  const decoded = jpeg.decode(bytes, { useTArray: true }).data;
  const p = psnr(source, decoded);
  writeFileSync(new URL(`${name}.jpg`, outDir), bytes);
  writeFileSync(
    new URL(`${name}-diff.png`, outDir),
    png(diffImage(source, decoded), width, height)
  );
  rows.push({ name, options, size: bytes.length, bpp: (bytes.length * 8) / (width * height), p });
  console.log(
    `${name.padEnd(18)} ${String(bytes.length).padStart(6)} bytes  Y ${p.y.toFixed(2)} dB  RGB ${p.rgb.toFixed(2)} dB`
  );
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>jpeg-encoder-wasm visual report</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px; background: #fff; color: #111; }
  table { border-collapse: collapse; }
  td, th { padding: 6px 10px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  img { width: 256px; height: 256px; image-rendering: pixelated; display: block; }
  code { font-size: 12px; }
  td:nth-child(4), td:nth-child(5) { white-space: nowrap; }
</style>
<h1>jpeg-encoder-wasm visual report</h1>
<p>Test pattern ${width}×${height}. Difference images show |source − decoded| × 8.</p>
<p><img src="source.png" alt="source"></p>
<table>
  <tr><th>Case</th><th>JPEG</th><th>Difference ×8</th><th>Size</th><th>PSNR</th></tr>
  ${rows
    .map(
      (r) => `<tr>
    <td><b>${r.name}</b><br><code>${JSON.stringify(r.options)}</code></td>
    <td><img src="${r.name}.jpg" alt="${r.name}"></td>
    <td><img src="${r.name}-diff.png" alt="${r.name} difference"></td>
    <td>${r.size.toLocaleString()} bytes<br>${r.bpp.toFixed(2)} bits/pixel</td>
    <td>Y ${r.p.y.toFixed(2)} dB<br>RGB ${r.p.rgb.toFixed(2)} dB<br>R ${r.p.r.toFixed(2)} / G ${r.p.g.toFixed(2)} / B ${r.p.b.toFixed(2)}</td>
  </tr>`
    )
    .join('\n  ')}
</table>
`;
writeFileSync(new URL('index.html', outDir), html);
console.log(`Wrote ${new URL('index.html', outDir).pathname}`);
