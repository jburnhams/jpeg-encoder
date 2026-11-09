// Visual quality checks: decode the output and measure it against the source.
//
// - PSNR floors per quality, and quality/size/PSNR must increase together
// - At 4:4:4 the output must match jpeg-js (an independent IJG-style encoder)
//   in PSNR and size, which catches broken DCT, quantization or colour code
// - Averaged chroma subsampling must beat nearest-pixel subsampling
// - Golden hashes: any change to the encoded bytes fails until accepted with
//   `npm run test:golden:update`, so output changes are always deliberate
//
// `npm run report` writes the same cases as images to compare by eye.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';

import init, {
  encodeJpeg,
  WasmColorType,
  WasmQuantizationTable,
  WasmSamplingFactor,
} from 'jpeg-encoder-wasm';
import { makeTestPattern, psnr, rgbaToRgb } from './helpers.js';
import { goldenCases } from './cases.js';

await init();

const width = 256;
const height = 256;
const source = makeTestPattern(width, height);

function measure(options) {
  const bytes = encodeJpeg(source, width, height, WasmColorType.Rgba, options);
  const decoded = jpeg.decode(bytes, { useTArray: true });
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  return { bytes, size: bytes.length, psnr: psnr(source, decoded.data) };
}

test('PSNR floors per quality', () => {
  const floors = { 30: 32, 50: 33.5, 75: 36, 90: 41, 95: 46 };
  for (const [quality, floor] of Object.entries(floors)) {
    const { psnr: p } = measure({ quality: Number(quality) });
    assert.ok(p.y > floor, `quality ${quality}: luma PSNR ${p.y.toFixed(2)} dB is below ${floor} dB`);
  }
});

test('higher quality gives larger files and higher PSNR', () => {
  let previous;
  for (const quality of [10, 30, 50, 70, 85, 95, 100]) {
    const current = measure({ quality, samplingFactor: WasmSamplingFactor.F_1_1 });
    if (previous) {
      assert.ok(current.size > previous.size, `quality ${quality} file is not larger`);
      assert.ok(current.psnr.y > previous.psnr.y, `quality ${quality} PSNR is not higher`);
    }
    previous = current;
  }
});

test('matches an independent encoder (jpeg-js) at 4:4:4', () => {
  for (const quality of [50, 75, 90, 95]) {
    const ours = measure({ quality, samplingFactor: WasmSamplingFactor.F_1_1 });
    const theirs = jpeg.encode({ data: source, width, height }, quality).data;
    const theirPsnr = psnr(source, jpeg.decode(theirs, { useTArray: true }).data);

    assert.ok(
      Math.abs(ours.psnr.y - theirPsnr.y) < 0.3,
      `quality ${quality}: luma PSNR ${ours.psnr.y.toFixed(2)} vs jpeg-js ${theirPsnr.y.toFixed(2)}`,
    );
    const ratio = ours.size / theirs.length;
    assert.ok(ratio > 0.9 && ratio < 1.1, `quality ${quality}: size ${ours.size} vs jpeg-js ${theirs.length}`);
  }
});

test('averaged chroma subsampling beats nearest pixel', () => {
  for (const quality of [50, 75, 90]) {
    const base = { quality, samplingFactor: WasmSamplingFactor.F_2_2 };
    const nearest = measure(base);
    const average = measure({ ...base, chromaSubsampling: 'average' });
    assert.ok(
      average.psnr.rgb > nearest.psnr.rgb + 0.2,
      `quality ${quality}: average ${average.psnr.rgb.toFixed(2)} dB vs nearest ${nearest.psnr.rgb.toFixed(2)} dB`,
    );
    assert.ok(Math.abs(average.psnr.y - nearest.psnr.y) < 0.2, 'luma is unaffected');
  }
});

test('quantization presets all decode with reasonable quality', () => {
  for (const [name, table] of Object.entries(WasmQuantizationTable)) {
    if (typeof table !== 'number') continue;
    const { psnr: p } = measure({ quality: 85, quantizationTable: table });
    assert.ok(p.y > 30, `${name}: luma PSNR ${p.y.toFixed(2)} dB`);
  }
});

test('RGB and RGBA input give identical output', () => {
  const rgba = encodeJpeg(source, width, height, WasmColorType.Rgba, 80);
  const rgb = encodeJpeg(rgbaToRgb(source), width, height, WasmColorType.Rgb, 80);
  assert.deepEqual(rgb, rgba);
});

const goldenPath = new URL('./golden.json', import.meta.url);

test('output matches the golden hashes', () => {
  const actual = {};
  for (const { name, options } of goldenCases) {
    const bytes = encodeJpeg(source, width, height, WasmColorType.Rgba, options);
    actual[name] = createHash('sha256').update(bytes).digest('hex');
  }

  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + '\n');
    return;
  }

  const expected = JSON.parse(readFileSync(goldenPath, 'utf8'));
  assert.deepEqual(
    actual,
    expected,
    'Encoded output changed. If that is intended (check `npm run report`), run `npm run test:golden:update`.',
  );
});
