import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';

import init, {
  encodeJpeg,
  StreamingJpegEncoder,
  WasmColorType,
  WasmDensityUnit,
  WasmQuantizationTable,
  WasmSamplingFactor,
} from 'jpeg-encoder-wasm';
import { concat, encodeInStrips, makeImage, makeTestPattern } from './helpers.js';

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
    assert.ok(
      meanError(data, bpp, decoded) < 3,
      `colour type ${colorType} decodes close to the input`
    );
  }
});

test('output does not depend on strip height', () => {
  const width = 50;
  const height = 37;
  const data = makeImage(width, height, 4);
  const reference = encodeJpeg(data, width, height, WasmColorType.Rgba, 80);

  for (const rows of [1, 3, 8, 15, 16, 17, 36, 37]) {
    const bytes = encodeInStrips(
      StreamingJpegEncoder,
      data,
      width,
      height,
      4,
      WasmColorType.Rgba,
      80,
      rows
    );
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

/** Parse the marker segments before the scan: [{ marker, data }] */
function segments(bytes) {
  const out = [];
  let i = 2;
  while (i < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    out.push({ marker, data: bytes.subarray(i + 4, i + 2 + length) });
    if (marker === 0xda) break; // start of scan
    i += 2 + length;
  }
  return out;
}

const text = (bytes) => String.fromCharCode(...bytes);

test('options object and positional arguments give the same output', () => {
  const data = makeImage(30, 20, 3);
  assert.deepEqual(
    encodeJpeg(data, 30, 20, WasmColorType.Rgb, {
      quality: 70,
      samplingFactor: WasmSamplingFactor.F_2_1,
    }),
    encodeJpeg(data, 30, 20, WasmColorType.Rgb, 70, WasmSamplingFactor.F_2_1)
  );
  // Default quality is 85
  assert.deepEqual(
    encodeJpeg(data, 30, 20, WasmColorType.Rgb),
    encodeJpeg(data, 30, 20, WasmColorType.Rgb, 85)
  );
  assert.deepEqual(
    encodeJpeg(data, 30, 20, WasmColorType.Rgb, {}),
    encodeJpeg(data, 30, 20, WasmColorType.Rgb, 85)
  );
});

test('dpi and density are written to the JFIF header', () => {
  const data = makeImage(8, 8, 3);
  const jfif = (options) =>
    segments(encodeJpeg(data, 8, 8, WasmColorType.Rgb, options)).find((s) => s.marker === 0xe0)
      .data;

  // JFIF\0, version (2 bytes), unit, x density, y density
  assert.deepEqual([...jfif({}).subarray(7, 12)], [0, 0, 1, 0, 1]);
  assert.deepEqual([...jfif({ dpi: 300 }).subarray(7, 12)], [1, 0x01, 0x2c, 0x01, 0x2c]);
  assert.deepEqual([...jfif({ dpi: { x: 72, y: 144 } }).subarray(7, 12)], [1, 0, 72, 0, 144]);
  assert.deepEqual(
    [...jfif({ density: { x: 118, y: 118, unit: WasmDensityUnit.Centimeter } }).subarray(7, 12)],
    [2, 0, 118, 0, 118]
  );
});

test('EXIF and ICC profile are embedded', () => {
  const exif = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 0]);
  const icc = new Uint8Array(100_000).map((_, i) => i % 256);
  const bytes = encodeJpeg(makeImage(8, 8, 3), 8, 8, WasmColorType.Rgb, { exif, iccProfile: icc });
  const all = segments(bytes);

  const app1 = all.find((s) => s.marker === 0xe1);
  assert.equal(text(app1.data.subarray(0, 6)), 'Exif\0\0');
  assert.deepEqual(app1.data.subarray(6), exif);

  // A 100 KB profile is split over two APP2 segments
  const app2 = all.filter((s) => s.marker === 0xe2);
  assert.equal(app2.length, 2);
  assert.equal(text(app2[0].data.subarray(0, 12)), 'ICC_PROFILE\0');
  assert.deepEqual([app2[0].data[12], app2[0].data[13]], [1, 2]);
  assert.deepEqual(concat(app2.map((s) => s.data.subarray(14))), icc);

  assert.equal(jpeg.decode(bytes).width, 8);
});

test('restart interval writes DRI and restart markers', () => {
  const bytes = encodeJpeg(makeImage(64, 64, 3), 64, 64, WasmColorType.Rgb, {
    quality: 80,
    restartInterval: 2,
  });
  const dri = segments(bytes).find((s) => s.marker === 0xdd);
  assert.deepEqual([...dri.data], [0, 2]);

  let rst = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] >= 0xd0 && bytes[i + 1] <= 0xd7) rst++;
  }
  assert.equal(rst, 7, '16 MCUs with a restart every 2 MCUs');
  assert.equal(jpeg.decode(bytes).width, 64);
});

test('quantization table preset changes the DQT segment', () => {
  const data = makeImage(16, 16, 3);
  const dqt = (options) =>
    segments(encodeJpeg(data, 16, 16, WasmColorType.Rgb, options)).filter((s) => s.marker === 0xdb);
  assert.notDeepEqual(
    dqt({ quality: 75 }),
    dqt({ quality: 75, quantizationTable: WasmQuantizationTable.ImageMagick })
  );
  assert.deepEqual(
    dqt({ quality: 75 }),
    dqt({ quality: 75, quantizationTable: WasmQuantizationTable.Default })
  );
});

test('chroma averaging changes the output only when chroma is subsampled', () => {
  const data = makeTestPattern(64, 64);
  const enc = (options) =>
    encodeJpeg(data, 64, 64, WasmColorType.Rgba, { quality: 80, ...options });
  assert.notDeepEqual(enc({ chromaSubsampling: 'average' }), enc({}));
  assert.deepEqual(enc({ chromaSubsampling: 'nearest' }), enc({}));
  const full = { samplingFactor: WasmSamplingFactor.F_1_1 };
  assert.deepEqual(enc({ ...full, chromaSubsampling: 'average' }), enc(full));
});

test('rejects invalid options', () => {
  assert.throws(
    () => new StreamingJpegEncoder(8, 8, WasmColorType.Rgb, { quality: 0 }),
    RangeError
  );
  assert.throws(() => new StreamingJpegEncoder(8, 8, WasmColorType.Rgb, 101), RangeError);
  assert.throws(
    () => new StreamingJpegEncoder(8, 8, WasmColorType.Rgb, { chromaSubsampling: 'bilinear' }),
    TypeError
  );
  assert.throws(
    () => new StreamingJpegEncoder(8, 8, WasmColorType.Rgb, { exif: new Uint8Array(70_000) }),
    /App segment exceeds/
  );
});

test('free() and Symbol.dispose are safe to call repeatedly', () => {
  const encoder = new StreamingJpegEncoder(8, 8, WasmColorType.Rgb, 80);
  encoder[Symbol.dispose]();
  encoder.free();
  assert.equal(encoder.rows_remaining, 0);
  assert.throws(() => encoder.encode_strip(new Uint8Array(24)), /already been finished or freed/);
});
