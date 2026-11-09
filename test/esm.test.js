import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';

import init, {
  encodeJpeg,
  StreamingJpegEncoder,
  WasmColorType,
  WasmSamplingFactor,
} from 'jpeg-encoder-wasm';
import { concat, encodeInStrips, makeImage } from './helpers.js';

// No argument: the bundled .wasm file must load in Node too
await init();

function assertJpeg(bytes) {
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8], 'starts with SOI');
  assert.deepEqual([...bytes.subarray(-2)], [0xff, 0xd9], 'ends with EOI');
}

/** Mean absolute difference between RGB(A) input and decoded RGBA output */
function meanError(input, bpp, decoded) {
  let sum = 0;
  let count = 0;
  for (let p = 0; p < decoded.width * decoded.height; p++) {
    for (let c = 0; c < Math.min(bpp, 3); c++) {
      const expected = bpp === 1 ? input[p] : input[p * bpp + c];
      sum += Math.abs(expected - decoded.data[p * 4 + c]);
      count++;
    }
  }
  return sum / count;
}

test('init() can be called again', async () => {
  await init();
});

test('encodes RGB, RGBA and grayscale images that decode back to the input', () => {
  for (const [colorType, bpp] of [
    [WasmColorType.Rgb, 3],
    [WasmColorType.Rgba, 4],
    [WasmColorType.Luma, 1],
  ]) {
    const width = 67;
    const height = 45;
    const data = makeImage(width, height, bpp);
    const bytes = encodeJpeg(data, width, height, colorType, 95);
    assertJpeg(bytes);

    const decoded = jpeg.decode(bytes, { useTArray: true });
    assert.equal(decoded.width, width);
    assert.equal(decoded.height, height);
    assert.ok(meanError(data, bpp, decoded) < 3, `colour type ${colorType} decodes close to the input`);
  }
});

test('output does not depend on strip height', () => {
  const width = 50;
  const height = 37;
  const data = makeImage(width, height, 4);
  const reference = encodeJpeg(data, width, height, WasmColorType.Rgba, 80);

  for (const rows of [1, 3, 8, 15, 16, 17, 36, 37]) {
    const bytes = encodeInStrips(StreamingJpegEncoder, data, width, height, 4, WasmColorType.Rgba, 80, rows);
    assert.deepEqual(bytes, reference, `strips of ${rows} rows`);
  }
});

test('headers are available right after construction', () => {
  const encoder = new StreamingJpegEncoder(16, 16, WasmColorType.Rgb, 80);
  const header = encoder.take_output();
  assert.deepEqual([...header.subarray(0, 2)], [0xff, 0xd8]);
  assert.equal(encoder.take_output().length, 0);
  encoder.free();
});

test('bytes are returned as soon as an MCU row is complete', () => {
  const width = 32;
  const data = makeImage(width, 32, 3);
  const encoder = new StreamingJpegEncoder(width, 32, WasmColorType.Rgb, 80);
  encoder.take_output();

  // 4:2:0 MCU rows are 16 image rows high
  assert.equal(encoder.encode_strip(data.subarray(0, width * 3 * 15)).length, 0);
  assert.ok(encoder.encode_strip(data.subarray(width * 3 * 15, width * 3 * 16)).length > 0);
  assert.equal(encoder.rows_remaining, 16);
  encoder.free();
});

test('sampling factor option', () => {
  const width = 40;
  const height = 24;
  const data = makeImage(width, height, 3);
  // Below quality 90 the default is 4:2:0
  const subsampled = encodeJpeg(data, width, height, WasmColorType.Rgb, 80);
  const full = encodeJpeg(data, width, height, WasmColorType.Rgb, 80, WasmSamplingFactor.F_1_1);
  assertJpeg(full);
  assert.notDeepEqual(full, subsampled);
  assert.equal(jpeg.decode(full).width, width);
});

test('rejects strips that are not whole rows or are too many rows', () => {
  const encoder = new StreamingJpegEncoder(4, 2, WasmColorType.Rgb, 80);
  assert.throws(() => encoder.encode_strip(new Uint8Array(13)), /multiple of the row length/);
  assert.throws(() => encoder.encode_strip(new Uint8Array(36)), /only 2 remain/);
  assert.equal(encoder.rows_remaining, 2);
  encoder.free();
});

test('finish() before all rows throws and keeps the encoder usable', () => {
  const encoder = new StreamingJpegEncoder(4, 2, WasmColorType.Rgb, 80);
  const chunks = [encoder.encode_strip(new Uint8Array(12))];
  assert.throws(() => encoder.finish(), /1 rows have not been encoded/);

  chunks.push(encoder.encode_strip(new Uint8Array(12)));
  chunks.push(encoder.finish());
  assertJpeg(concat(chunks));

  assert.throws(() => encoder.finish(), /already been finished/);
  encoder.free();
});

test('rejects invalid dimensions', () => {
  assert.throws(() => new StreamingJpegEncoder(0, 10, WasmColorType.Rgb, 80), /non zero/);
});
