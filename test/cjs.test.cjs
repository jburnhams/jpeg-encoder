const { test } = require('node:test');
const assert = require('node:assert/strict');

const { init, encodeJpeg, StreamingJpegEncoder, WasmColorType } = require('jpeg-encoder-wasm');

test('CommonJS build encodes without awaiting init()', () => {
  const bytes = encodeJpeg(new Uint8Array(20 * 10 * 4).fill(200), 20, 10, WasmColorType.Rgba, 85);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...bytes.subarray(-2)], [0xff, 0xd9]);
});

test('CommonJS and ESM builds produce identical output', async () => {
  const esm = await import('jpeg-encoder-wasm');
  await esm.init();
  await init();

  const data = new Uint8Array(30 * 20 * 3).map((_, i) => i % 251);
  const viaRequire = encodeJpeg(data, 30, 20, WasmColorType.Rgb, 75);
  const viaImport = esm.encodeJpeg(data, 30, 20, esm.WasmColorType.Rgb, 75);
  assert.deepEqual(viaRequire, viaImport);

  const options = { quality: 60, chromaSubsampling: 'average', dpi: 300, restartInterval: 2 };
  assert.deepEqual(
    encodeJpeg(data, 30, 20, WasmColorType.Rgb, options),
    esm.encodeJpeg(data, 30, 20, esm.WasmColorType.Rgb, options),
  );
});

test('streaming API is available', () => {
  const encoder = new StreamingJpegEncoder(8, 8, WasmColorType.Luma, 50);
  const body = encoder.encode_strip(new Uint8Array(64).fill(128));
  const tail = encoder.finish();
  assert.ok(body.length + tail.length > 0);
});
