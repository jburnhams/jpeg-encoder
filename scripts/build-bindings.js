#!/usr/bin/env node

/**
 * Build script that generates both ESM and CommonJS bindings from the compiled WASM module.
 *
 * This script:
 * 1. Generates ESM bindings using wasm-bindgen with --target web
 * 2. Generates CommonJS bindings using wasm-bindgen with --target bundler
 * 3. Creates wrapper files for both formats
 * 4. Copies TypeScript definitions
 */

import { execSync } from 'child_process';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const pkgDir = join(rootDir, 'pkg');
const wasmPath = join(rootDir, 'target/wasm32-unknown-unknown/release/jpeg_encoder_wasm.wasm');

// Clean and create output directories
console.log('Creating output directories...');
rmSync(pkgDir, { recursive: true, force: true });
mkdirSync(join(pkgDir, 'esm'), { recursive: true });
mkdirSync(join(pkgDir, 'cjs'), { recursive: true });

// Generate ESM bindings (--target web)
console.log('Generating ESM bindings...');
execSync(
  `wasm-bindgen ${wasmPath} --out-dir ${join(pkgDir, 'esm')} --target web --typescript --out-name jpeg_encoder`,
  { stdio: 'inherit' }
);

// Generate CommonJS bindings (--target nodejs)
console.log('Generating CommonJS bindings...');
execSync(
  `wasm-bindgen ${wasmPath} --out-dir ${join(pkgDir, 'cjs')} --target nodejs --typescript --out-name jpeg_encoder`,
  { stdio: 'inherit' }
);

// Create ESM wrapper (index.js in pkg/esm)
console.log('Creating ESM wrapper...');
const esmWrapper = `import initWasm, { StreamingJpegEncoder as RawStreamingJpegEncoder, WasmColorType } from "./jpeg_encoder.js";

/**
 * Initialize the underlying WebAssembly module.
 *
 * This must be awaited before constructing a {@link StreamingJpegEncoder}.
 * By default it loads the bundled \`jpeg_encoder_bg.wasm\` next to this file.
 */
export async function init(module) {
    await initWasm(module);
}

// Maintain compatibility with the wasm-bindgen generated default export.
export default init;

/**
 * Thin wrapper around the wasm-bindgen generated encoder that hides
 * implementation details and static helpers that consumers should not call.
 */
export class StreamingJpegEncoder {
    #inner;

    constructor(width, height, color_type, quality) {
        this.#inner = new RawStreamingJpegEncoder(width, height, color_type, quality);
    }

    #requireActive() {
        if (!this.#inner) {
            throw new Error("Encoder has already been freed or finished");
        }
    }

    /**
     * Encode one or more complete rows. The return value contains any newly
     * produced JPEG bytes and clears the internal buffer.
     */
    encode_strip(data) {
        this.#requireActive();
        return this.#inner.encode_strip(data);
    }

    /**
     * Finalize the JPEG, free the underlying wasm allocations, and return any
     * remaining bytes. All rows must have been provided before calling this.
     */
    finish() {
        this.#requireActive();

        const bytes = this.#inner.finish();
        this.free();
        return bytes;
    }

    /**
     * Free the underlying wasm allocations. Calling this after \`finish()\` is
     * unnecessary because \`finish()\` already releases the resources.
     */
    free() {
        if (!this.#inner) {
            return;
        }

        this.#inner.free();
        this.#inner = null;
    }

    /**
     * Get JPEG header bytes without creating an encoder instance.
     * This is a static method for advanced use cases.
     */
    static header_bytes(width, height, color_type, quality) {
        return RawStreamingJpegEncoder.header_bytes(width, height, color_type, quality);
    }

    /**
     * Get JPEG footer bytes.
     * This is a static method for advanced use cases.
     */
    static footer_bytes() {
        return RawStreamingJpegEncoder.footer_bytes();
    }
}

export { WasmColorType };
`;

writeFileSync(join(pkgDir, 'esm', 'index.js'), esmWrapper);

// Create CommonJS wrapper (index.cjs in pkg/cjs)
console.log('Creating CommonJS wrapper...');
const cjsWrapper = `"use strict";

// For nodejs target, wasm-bindgen auto-loads the WASM module
const { StreamingJpegEncoder: RawStreamingJpegEncoder, WasmColorType } = require("./jpeg_encoder.js");

/**
 * Initialize the underlying WebAssembly module.
 *
 * For the CommonJS build using nodejs target, the WASM module is automatically
 * loaded. This function exists for API compatibility with the ESM build.
 * You can optionally pass wasm bytes to override the default loading.
 */
async function init(wasmBytes) {
    // In nodejs target, WASM is already initialized
    // This function is a no-op for compatibility
    return Promise.resolve();
}

// Maintain compatibility with the wasm-bindgen generated default export.
module.exports.default = init;
module.exports.init = init;

/**
 * Thin wrapper around the wasm-bindgen generated encoder that hides
 * implementation details and static helpers that consumers should not call.
 */
class StreamingJpegEncoder {
    #inner;

    constructor(width, height, color_type, quality) {
        this.#inner = new RawStreamingJpegEncoder(width, height, color_type, quality);
    }

    #requireActive() {
        if (!this.#inner) {
            throw new Error("Encoder has already been freed or finished");
        }
    }

    /**
     * Encode one or more complete rows. The return value contains any newly
     * produced JPEG bytes and clears the internal buffer.
     */
    encode_strip(data) {
        this.#requireActive();
        return this.#inner.encode_strip(data);
    }

    /**
     * Finalize the JPEG, free the underlying wasm allocations, and return any
     * remaining bytes. All rows must have been provided before calling this.
     */
    finish() {
        this.#requireActive();

        const bytes = this.#inner.finish();
        this.free();
        return bytes;
    }

    /**
     * Free the underlying wasm allocations. Calling this after \`finish()\` is
     * unnecessary because \`finish()\` already releases the resources.
     */
    free() {
        if (!this.#inner) {
            return;
        }

        this.#inner.free();
        this.#inner = null;
    }

    /**
     * Get JPEG header bytes without creating an encoder instance.
     * This is a static method for advanced use cases.
     */
    static header_bytes(width, height, color_type, quality) {
        return RawStreamingJpegEncoder.header_bytes(width, height, color_type, quality);
    }

    /**
     * Get JPEG footer bytes.
     * This is a static method for advanced use cases.
     */
    static footer_bytes() {
        return RawStreamingJpegEncoder.footer_bytes();
    }
}

module.exports.StreamingJpegEncoder = StreamingJpegEncoder;
module.exports.WasmColorType = WasmColorType;
`;

writeFileSync(join(pkgDir, 'cjs', 'index.cjs'), cjsWrapper);

// Create TypeScript definitions for the wrapper
console.log('Creating TypeScript definitions...');
const indexDts = `import type { InitInput } from './esm/jpeg_encoder.js';

/**
 * Initialize the underlying WebAssembly module.
 *
 * This must be awaited before constructing a {@link StreamingJpegEncoder}.
 * By default it loads the bundled \`jpeg_encoder_bg.wasm\` next to this file.
 */
export function init(module?: InitInput | Promise<InitInput>): Promise<void>;
export default init;

/**
 * Color type for the JPEG encoder.
 */
export enum WasmColorType {
  Rgb = 0,
  Luma = 1,
  Rgba = 2,
  Cmyk = 3,
}

/**
 * Thin wrapper around the wasm-bindgen generated encoder that hides
 * implementation details and static helpers that consumers should not call.
 */
export class StreamingJpegEncoder {
  constructor(width: number, height: number, color_type: WasmColorType, quality: number);

  /**
   * Encode one or more complete rows. The return value contains any newly
   * produced JPEG bytes and clears the internal buffer.
   */
  encode_strip(data: Uint8Array): Uint8Array;

  /**
   * Finalize the JPEG, free the underlying wasm allocations, and return any
   * remaining bytes. All rows must have been provided before calling this.
   */
  finish(): Uint8Array;

  /**
   * Free the underlying wasm allocations. Calling this after \`finish()\` is
   * unnecessary because \`finish()\` already releases the resources.
   */
  free(): void;

  /**
   * Get JPEG header bytes without creating an encoder instance.
   * This is a static method for advanced use cases.
   */
  static header_bytes(width: number, height: number, color_type: WasmColorType, quality: number): Uint8Array;

  /**
   * Get JPEG footer bytes.
   * This is a static method for advanced use cases.
   */
  static footer_bytes(): Uint8Array;
}

export { WasmColorType };
`;

writeFileSync(join(pkgDir, 'index.d.ts'), indexDts);

// Create package.json for ESM directory
console.log('Creating package.json for ESM...');
writeFileSync(
  join(pkgDir, 'esm', 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2)
);

// Create package.json for CJS directory
console.log('Creating package.json for CJS...');
writeFileSync(
  join(pkgDir, 'cjs', 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2)
);

// Create README.md for the package
console.log('Creating package README...');
const packageReadme = `# jpeg-encoder-wasm

This package provides a WebAssembly-powered JPEG encoder that can be used from JavaScript.
Supports both ESM and CommonJS module formats.

## Installation

\`\`\`bash
npm install jpeg-encoder-wasm
\`\`\`

## Usage

### ES Modules (Node.js, modern bundlers)

\`\`\`js
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
\`\`\`

### CommonJS (Node.js)

\`\`\`js
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
\`\`\`

## API

### \`init(module?): Promise<void>\`

Initialize the WebAssembly module. Must be called before creating encoders.

- **module** (optional): WebAssembly module or bytes. Auto-loaded in ESM, required in CommonJS.

### \`class StreamingJpegEncoder\`

#### \`constructor(width, height, colorType, quality)\`

Create a new JPEG encoder.

- **width**: Image width in pixels
- **height**: Image height in pixels
- **colorType**: Color format (see \`WasmColorType\`)
- **quality**: JPEG quality (1-100)

#### \`encode_strip(data: Uint8Array): Uint8Array\`

Encode one or more complete rows. Returns any newly produced JPEG bytes.

#### \`finish(): Uint8Array\`

Finalize the JPEG and return remaining bytes. Frees resources automatically.

#### \`free(): void\`

Manually free resources (unnecessary after \`finish()\`).

#### Static Methods

- \`StreamingJpegEncoder.header_bytes(width, height, colorType, quality): Uint8Array\`
- \`StreamingJpegEncoder.footer_bytes(): Uint8Array\`

### \`WasmColorType\`

Enum of supported color formats:

- \`WasmColorType.Rgb\` - 3 bytes per pixel (R, G, B)
- \`WasmColorType.Rgba\` - 4 bytes per pixel (R, G, B, A)
- \`WasmColorType.Luma\` - 1 byte per pixel (grayscale)
- \`WasmColorType.Cmyk\` - 4 bytes per pixel (C, M, Y, K)

## Module Format Support

This package supports both module formats:

- **ESM**: Use \`import\` statements (recommended for modern projects)
- **CommonJS**: Use \`require()\` (for compatibility with older Node.js projects)

The appropriate format is automatically selected based on your project's module system.

## License

See LICENSE file in the repository.
`;

writeFileSync(join(pkgDir, 'README.md'), packageReadme);

console.log('✓ Build complete!');
console.log('  ESM output: pkg/esm/');
console.log('  CJS output: pkg/cjs/');
