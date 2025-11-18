# jpeg-encoder-wasm

This package provides a WebAssembly-powered JPEG encoder that can be used from JavaScript.
Supports both ESM and CommonJS module formats.

## Installation

```bash
npm install jpeg-encoder-wasm
```

## Usage

### ES Modules (Node.js, modern bundlers)

```js
import init, { StreamingJpegEncoder, WasmColorType } from "jpeg-encoder-wasm";

async function encode() {
  // Initialize the WASM module
  await init();

  const width = 320;
  const height = 240;
  const quality = 90;

  const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, quality);

  // Create image data (RGB format)
  const pixels = new Uint8Array(width * height * 3);
  // ... fill pixels ...

  const chunk1 = encoder.encode_strip(pixels);
  const chunk2 = encoder.finish();

  // Combine chunks into final JPEG
  const jpegData = new Uint8Array(chunk1.length + chunk2.length);
  jpegData.set(chunk1, 0);
  jpegData.set(chunk2, chunk1.length);

  return jpegData;
}
```

### CommonJS (Node.js)

```js
const { init, StreamingJpegEncoder, WasmColorType } = require("jpeg-encoder-wasm");
const { readFileSync } = require("fs");

async function encode() {
  // Initialize with WASM file (required in Node.js CommonJS)
  const wasmPath = require.resolve("jpeg-encoder-wasm/pkg/cjs/jpeg_encoder_bg.wasm");
  await init(readFileSync(wasmPath));

  const width = 320;
  const height = 240;
  const quality = 90;

  const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, quality);

  // Create image data
  const pixels = new Uint8Array(width * height * 3);
  // ... fill pixels ...

  const chunk1 = encoder.encode_strip(pixels);
  const chunk2 = encoder.finish();

  return Buffer.concat([chunk1, chunk2]);
}
```

## API

### `init(module?): Promise<void>`

Initialize the WebAssembly module. Must be called before creating encoders.

- **module** (optional): WebAssembly module or bytes. Auto-loaded in ESM, required in CommonJS.

### `class StreamingJpegEncoder`

#### `constructor(width, height, colorType, quality)`

Create a new JPEG encoder.

- **width**: Image width in pixels
- **height**: Image height in pixels
- **colorType**: Color format (see `WasmColorType`)
- **quality**: JPEG quality (1-100)

#### `encode_strip(data: Uint8Array): Uint8Array`

Encode one or more complete rows. Returns any newly produced JPEG bytes.

#### `finish(): Uint8Array`

Finalize the JPEG and return remaining bytes. Frees resources automatically.

#### `free(): void`

Manually free resources (unnecessary after `finish()`).

#### Static Methods

- `StreamingJpegEncoder.header_bytes(width, height, colorType, quality): Uint8Array`
- `StreamingJpegEncoder.footer_bytes(): Uint8Array`

### `WasmColorType`

Enum of supported color formats:

- `WasmColorType.Rgb` - 3 bytes per pixel (R, G, B)
- `WasmColorType.Rgba` - 4 bytes per pixel (R, G, B, A)
- `WasmColorType.Luma` - 1 byte per pixel (grayscale)
- `WasmColorType.Cmyk` - 4 bytes per pixel (C, M, Y, K)

## Module Format Support

This package supports both module formats:

- **ESM**: Use `import` statements (recommended for modern projects)
- **CommonJS**: Use `require()` (for compatibility with older Node.js projects)

The appropriate format is automatically selected based on your project's module system.

## License

See LICENSE file in the repository.
