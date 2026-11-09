# jpeg-encoder-wasm

[![npm](https://img.shields.io/npm/v/jpeg-encoder-wasm.svg)](https://www.npmjs.com/package/jpeg-encoder-wasm)
[![WebAssembly package](https://github.com/jburnhams/jpeg-encoder/actions/workflows/wasm.yml/badge.svg)](https://github.com/jburnhams/jpeg-encoder/actions/workflows/wasm.yml)
[![Rust](https://github.com/jburnhams/jpeg-encoder/actions/workflows/rust.yml/badge.svg)](https://github.com/jburnhams/jpeg-encoder/actions/workflows/rust.yml)

A streaming JPEG encoder for JavaScript (Node and browsers), built as WebAssembly
from a fork of the Rust [`jpeg-encoder`](https://github.com/vstroebel/jpeg-encoder)
crate by Volker Ströbel.

You feed the image **a strip of rows at a time** and get JPEG bytes back as you go,
so even very large images are encoded with only a few rows in memory. The npm
package is under 50 KiB of WebAssembly with no dependencies, and encodes about
55 megapixels per second in Node (roughly 6× faster than the pure JavaScript `jpeg-js`).

[Live demo](https://jburnhams.github.io/jpeg-encoder/)

- [What this fork adds](#what-this-fork-adds)
- [JavaScript usage](#javascript-usage)
- [Rust usage: `StripEncoder`](#rust-usage-stripencoder)
- [Building and testing](#building-and-testing)
- [Upstream jpeg-encoder](#upstream-jpeg-encoder)

## What this fork adds

The fork tracks upstream `main` (currently `jpeg-encoder` 0.8.0) and adds:

1. **`StripEncoder`, a streaming encoder in the Rust crate** ([`src/encoder/strip.rs`](src/encoder/strip.rs)).
   `Encoder::into_strip_encoder(width, height, color_type)` writes the JPEG headers,
   then `encode_strip(rows)` accepts any whole number of rows and writes each row
   of MCUs (8 image rows, or 16 with vertical chroma subsampling) as soon as it's
   complete, and `finish()` writes the end marker.
   - Output is **byte-for-byte identical** to `Encoder::encode` with the same settings
     (the tests check every color type, sampling factor, restart intervals, averaged
     chroma subsampling and strip heights from 1 row to the whole image).
   - It reuses upstream's encoder for each MCU row (including AVX2 with the `simd`
     feature and the colour conversion code), so upstream improvements apply to it.
   - All encoder settings work except progressive encoding and optimized huffman
     tables, which need the whole image before writing; these, and sampling factors
     that can't be interleaved (such as `F_4_1`), return an error.
   - Works in `no_std` like the rest of the crate.
   - The changes to upstream code are limited to splitting the interleaved encoder
     into per-MCU-row steps, an `EncodingError::StripEncoding` variant and two
     writer accessors, which keeps merging upstream easy.
2. **WebAssembly bindings** ([`wasm-bindings/`](wasm-bindings)), a separate crate
   so the core crate has no wasm dependencies.
3. **The npm package** `jpeg-encoder-wasm`: ESM (browsers, bundlers and Node, with
   the `.wasm` file loaded automatically) and CommonJS builds, TypeScript types,
   a one-call `encodeJpeg()` helper and an options object exposing upstream's
   settings (chroma averaging, DPI, EXIF, ICC profiles, quantization presets,
   restart intervals) ([`js/`](js), [`scripts/build-bindings.js`](scripts/build-bindings.js)).
4. **Tests for the JavaScript package**: decode checks, visual quality (PSNR)
   tests against an independent encoder, golden output hashes, a visual report,
   a real-browser test and a benchmark (see [Testing](#testing)).

## JavaScript usage

```bash
npm install jpeg-encoder-wasm
```

### Encode a whole image

```js
import init, { encodeJpeg, WasmColorType } from 'jpeg-encoder-wasm';

await init(); // loads the WebAssembly module once

// e.g. canvas.getContext('2d').getImageData(0, 0, width, height).data
const jpeg = encodeJpeg(rgbaPixels, width, height, WasmColorType.Rgba, 85);

// or with options
const print = encodeJpeg(rgbaPixels, width, height, WasmColorType.Rgba, {
  quality: 90,
  chromaSubsampling: 'average',
  dpi: 300,
  iccProfile: srgbProfileBytes,
});
```

### Stream strip by strip

```js
import init, { StreamingJpegEncoder, WasmColorType } from 'jpeg-encoder-wasm';

await init();

const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgba, { quality: 85 });
const chunks = [];

for (const strip of stripsOfRows) {
  // any number of complete rows: width * 4 bytes per row for RGBA
  chunks.push(encoder.encode_strip(strip));
}
chunks.push(encoder.finish()); // end of image; frees the WebAssembly memory

const jpeg = new Blob(chunks, { type: 'image/jpeg' });
```

Each returned chunk can be written straight to a file, an HTTP response or a
`WritableStream`. The first `encode_strip()` call also returns the JPEG headers
(or call `take_output()` right after constructing to get them on their own).

CommonJS works the same way (`const { encodeJpeg, WasmColorType } = require('jpeg-encoder-wasm')`);
there the module is loaded on `require()` and awaiting `init()` is optional.

### API

| | |
|---|---|
| `init(module?)` | Load the WebAssembly module. Await once before encoding; later calls return the same promise. With no argument it loads the bundled `jpeg_encoder_bg.wasm` (in Node it reads the file, in browsers it fetches it next to the module). Pass a URL, `Response`, bytes or `WebAssembly.Module` to load it from elsewhere; the file is also exported as `jpeg-encoder-wasm/jpeg_encoder_bg.wasm`. |
| `new StreamingJpegEncoder(width, height, colorType, options?)` | Width and height 1 to 65535. `options` is described below. The older form `(width, height, colorType, quality, samplingFactor?)` still works. |
| `encoder.encode_strip(rows)` | Encode complete rows (`Uint8Array` or `Uint8ClampedArray`), returns the new JPEG bytes (possibly empty). Throws if the data isn't whole rows or there are more rows than the image has left. |
| `encoder.take_output()` | Return bytes produced so far without encoding anything. |
| `encoder.rows_remaining` | Rows still to be passed in. |
| `encoder.finish()` | Return the final bytes and free the encoder. Throws, and leaves the encoder usable, if rows are missing. |
| `encoder.free()` | Free the encoder without finishing. Safe to call more than once. |
| `encodeJpeg(pixels, width, height, colorType = Rgba, options?)` | Encode a whole image in one call. Also accepts `quality, samplingFactor?` in place of `options`. |
| `WasmColorType` | `Luma` (1 byte per pixel), `Rgb`, `Bgr`, `Ycbcr` (3), `Rgba`, `Bgra` (4, alpha ignored), `Cmyk`, `CmykAsYcck`, `Ycck` (4). |
| `WasmSamplingFactor` | `F_2_2` (4:2:0), `F_2_1` (4:2:2), `F_1_2` (4:4:0), `F_1_1` (4:4:4). Default: `F_2_2` below quality 90, `F_1_1` at 90 and above. |
| `WasmQuantizationTable` | `Default`, `Flat`, `MsSsim`, `PsnrHvs`, `ImageMagick`, `KleinSilversteinCarney`, `DentalXRays`, `VisualDetectionModel`, `ImprovedDetectionModel`. |
| `WasmDensityUnit` | `AspectRatio`, `Inch`, `Centimeter`. |

### Options

| Option | Default | |
|---|---|---|
| `quality` | `85` | 1 to 100. |
| `samplingFactor` | `F_2_2` below quality 90, `F_1_1` from 90 | Chroma subsampling (`WasmSamplingFactor`). |
| `chromaSubsampling` | `'nearest'` | `'average'` box-averages each block of colour samples like libjpeg instead of taking one pixel. Cleaner colour edges (about +0.5 to 1 dB RGB PSNR on the test pattern) for about 15% more encoding time. Only matters when chroma is subsampled. |
| `dpi` | none | Pixels per inch for the JFIF header: a number, or `{ x, y }`. |
| `density` | none | `{ x, y, unit }` with a `WasmDensityUnit`, for centimetres or an aspect ratio. |
| `quantizationTable` | `Default` | A `WasmQuantizationTable` preset for both luma and chroma. |
| `restartInterval` | none | MCUs between restart markers, so a damaged file can be partly decoded. |
| `exif` | none | Raw EXIF (TIFF) bytes, without the `Exif\0\0` prefix, up to 65,528 bytes. |
| `iccProfile` | none | ICC profile bytes; large profiles are split over several APP2 segments. |

## Rust usage: `StripEncoder`

The Rust crate in this repository is not published to crates.io; depend on it
with a git dependency if you need `StripEncoder`:

```toml
[dependencies]
jpeg-encoder = { git = "https://github.com/jburnhams/jpeg-encoder" }
```

```rust
use jpeg_encoder::{ColorType, Encoder};

let mut encoder = Encoder::new_file("big.jpeg", 85)?;
encoder.set_restart_interval(16); // any non-progressive setting works

let mut strips = encoder.into_strip_encoder(width, height, ColorType::Rgb)?;
for strip in rows_from_somewhere() {
    strips.encode_strip(&strip)?; // whole rows, any number at a time
}
strips.finish()?;
```

With a `Vec<u8>` writer, `strips.writer_mut()` lets you drain the bytes written
so far between strips (this is what the WebAssembly bindings do).

## Building and testing

Requirements: Rust (1.89 or newer) with the `wasm32-unknown-unknown` target,
`wasm-bindgen-cli` at the same version as the `wasm-bindgen` crate in `Cargo.lock`,
and Node 18 or newer. `wasm-opt` comes from the `binaryen` dev dependency.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked

npm ci
npm run build          # cargo build (wasm-release profile) + bindings into pkg/
```

### Testing

| Command | What it checks |
|---|---|
| `cargo test` | Rust tests, including `StripEncoder` producing exactly the same bytes as `Encoder::encode` for every colour type, sampling factor, restart interval, chroma method and strip height. |
| `npm test` | The npm package in Node: ESM and CommonJS builds, every option (checked in the written JPEG segments), error handling, output that doesn't depend on strip height, decoding back with `jpeg-js`, and the TypeScript types. Also the visual quality tests below. |
| `npm test` (quality) | [`test/quality.test.js`](test/quality.test.js) decodes the output and measures PSNR against the source: minimum PSNR per quality, quality/size/PSNR increasing together, matching the independent `jpeg-js` encoder at 4:4:4 (within 0.3 dB and 10% size), averaged chroma beating nearest-pixel, and every quantization preset. |
| `npm test` (golden) | SHA-256 hashes of the output for the cases in [`test/cases.js`](test/cases.js) are stored in [`test/golden.json`](test/golden.json). Any change to the encoded bytes (an upstream merge, a refactor) fails the test. If the change is intended, look at `npm run report` and accept it with `npm run test:golden:update`. |
| `npm run report` | Writes `report/index.html`: each golden case as a JPEG next to an amplified difference image, with size and PSNR, for checking by eye. CI uploads it as the `visual-report` artifact. |
| `npm run test:browser` | Encodes in real Chromium (Playwright) and decodes with the browser's own decoder. Run `npx playwright install chromium` once. |
| `npm run bench` | Throughput in megapixels per second for 1 MP and 12 MP images, several settings and 1-row strips, with `jpeg-js` as a baseline. `--quick` for a short run and `--json file` to save results. CI shows a quick run in the job summary; compare numbers from the same machine only. |

Benchmark on a typical x64 machine (Node 22):

| 1024×768 RGBA | Mpx/s |
|---|---|
| quality 85, 4:2:0 | 55 |
| quality 85, 4:2:0, averaged chroma | 46 |
| quality 95, 4:4:4 | 36 |
| quality 85, 4:2:0, 1-row strips | 53 |
| `jpeg-js` quality 85 | 8 to 10 |

WebAssembly SIMD was tried and isn't used: `simd128` alone was within 3% (noise),
and adding upstream's `use_wide` portable-SIMD DCT made it about 35% slower in wasm.

`pkg/` is a build output and isn't committed. CI builds and tests it on every
push and pull request, and deploys the demo in [`docs/`](docs) to GitHub Pages
from `main`.

### Releasing to npm

1. Bump `version` in `package.json` and merge to `main`.
2. Publish a GitHub release tagged `v<version>` (for example `v0.1.0`).
3. The [`npm-publish`](.github/workflows/npm-publish.yml) workflow builds, tests and
   runs `npm publish --provenance` using npm trusted publishing (no token stored
   in GitHub).

### Syncing with upstream

```bash
git remote add upstream https://github.com/vstroebel/jpeg-encoder
git fetch upstream
git merge upstream/main
cargo test && npm run build && npm test
```

Conflicts, if any, will be in `encode_image_interleaved` in `src/encoder.rs`,
which the fork splits into `init_interleaved_state` and `encode_interleaved_mcu_row`.

## Upstream jpeg-encoder

[![docs.rs badge](https://docs.rs/jpeg-encoder/badge.svg)](https://docs.rs/jpeg-encoder/)
[![crates.io badge](https://img.shields.io/crates/v/jpeg-encoder.svg)](https://crates.io/crates/jpeg-encoder/)

The rest of this README is upstream's. The Rust encoder features:

- Baseline and progressive compression
- Chroma subsampling
- Optimized huffman tables
- 1, 3 and 4 component colorspaces
- Restart interval
- Custom quantization tables
- AVX2 based optimizations (Optional)
- Support for no_std + alloc
- No `unsafe` by default (Enabling the `simd` feature adds unsafe code)

### Example
```rust
use jpeg_encoder::{Encoder, ColorType};

// An array with 4 pixels in RGB format.
let data = [
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
    255, 255, 255,
];

// Create new encoder that writes to a file with maximum quality (100)
let mut encoder = Encoder::new_file("some.jpeg", 100)?;

// Encode the data with dimension 2x2
encoder.encode(&data, 2, 2, ColorType::Rgb)?;
```

### Crate features
- `std` (default): Enables functionality dependent on the std lib
- `simd`: Enables SIMD optimizations (implies `std` and only AVX2 as for now)

### Minimum Supported Version of Rust (MSRV)

This crate needs at least 1.89 or higher.

## License

This project is licensed under either of

* Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or https://www.apache.org/licenses/LICENSE-2.0)
* MIT license ([LICENSE-MIT](LICENSE-MIT) or https://opensource.org/licenses/MIT)

at your option. Parts of the code are derived from the Independent JPEG Group's
software and are also covered by the [IJG license](LICENSE-IJG), hence the SPDX
expression `(MIT OR Apache-2.0) AND IJG`.

## Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in jpeg-encoder by you, as defined in the Apache-2.0 license,
shall be dual licensed as above, without any additional terms or conditions.
