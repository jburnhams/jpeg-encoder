// Performance harness for the WebAssembly encoder.
//
//   npm run build && npm run bench                 # full run
//   npm run bench -- --quick                       # fewer, smaller runs (CI)
//   npm run bench -- --json bench-results.json     # also save results
//
// Reports the median time and throughput (megapixels per second) for several
// image sizes and settings, plus jpeg-js (pure JavaScript) as a baseline.
// Numbers depend on the machine; compare runs on the same machine only.

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import jpeg from 'jpeg-js';

import init, { StreamingJpegEncoder, WasmColorType, WasmSamplingFactor } from 'jpeg-encoder-wasm';
import { makeTestPattern } from '../test/helpers.js';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

await init();

const sizes = quick
  ? [[1024, 768]]
  : [
      [1024, 768],
      [4000, 3000],
    ];

const cases = [
  { name: 'q85 4:2:0', options: { quality: 85 } },
  { name: 'q85 4:2:0 average', options: { quality: 85, chromaSubsampling: 'average' } },
  { name: 'q95 4:4:4', options: { quality: 95, samplingFactor: WasmSamplingFactor.F_1_1 } },
  { name: 'q85 4:2:0 1-row strips', options: { quality: 85 }, stripRows: 1 },
];

function encodeStreaming(pixels, width, height, options, stripRows) {
  const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgba, options);
  const rowBytes = width * 4;
  let size = 0;
  for (let y = 0; y < height; y += stripRows) {
    const end = Math.min(height, y + stripRows);
    size += encoder.encode_strip(pixels.subarray(y * rowBytes, end * rowBytes)).length;
  }
  return size + encoder.finish().length;
}

function time(fn, runs) {
  fn(); // warm up
  const samples = [];
  let result;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    result = fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { ms: samples[Math.floor(samples.length / 2)], result };
}

const results = [];
console.log(`Node ${process.version}, ${process.arch}${quick ? ', quick' : ''}\n`);
console.log('image       case                        median ms    Mpx/s     bytes');

for (const [width, height] of sizes) {
  const pixels = makeTestPattern(width, height);
  const mpx = (width * height) / 1e6;
  const runs = mpx > 4 ? (quick ? 2 : 5) : quick ? 5 : 15;

  const rows = cases.map((c) => ({
    name: c.name,
    ...time(() => encodeStreaming(pixels, width, height, c.options, c.stripRows ?? 16), runs),
  }));
  if (mpx <= 4) {
    rows.push({
      name: 'jpeg-js q85 (baseline)',
      ...time(
        () => jpeg.encode({ data: pixels, width, height }, 85).data.length,
        Math.max(2, runs / 3)
      ),
    });
  }

  for (const r of rows) {
    const entry = {
      image: `${width}x${height}`,
      case: r.name,
      ms: r.ms,
      mpxPerS: mpx / (r.ms / 1000),
      bytes: r.result,
    };
    results.push(entry);
    console.log(
      `${entry.image.padEnd(11)} ${entry.case.padEnd(26)} ${entry.ms.toFixed(1).padStart(10)} ${entry.mpxPerS.toFixed(1).padStart(8)} ${String(entry.bytes).padStart(9)}`
    );
  }
}

if (jsonPath) {
  writeFileSync(
    jsonPath,
    JSON.stringify({ node: process.version, arch: process.arch, results }, null, 2) + '\n'
  );
  console.log(`\nSaved ${jsonPath}`);
}
